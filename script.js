const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const tumblr = require('tumblr.js');
const ytdl = require('@distube/ytdl-core');


// Configuration for your Tumblr API access
const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;
const OAUTH_TOKEN = process.env.OAUTH_TOKEN;
const OAUTH_TOKEN_SECRET = process.env.OAUTH_TOKEN_SECRET;

// Tumblr blog details
const blogName = process.env.BLOG_NAME;
const backupDir = './tumblr_backup';
const progressFile = './progress.json';

// Initialize Tumblr client
const client = tumblr.createClient({
  consumer_key: API_KEY,
  consumer_secret: API_SECRET,
  token: OAUTH_TOKEN,
  token_secret: OAUTH_TOKEN_SECRET
});

// Load progress from previous runs
let progress = {};
if (fs.existsSync(progressFile)) {
  progress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
}

// Create the backup directory if it doesn't exist
fs.mkdirSync(backupDir, { recursive: true });

async function downloadToFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('No response body to download.');
  }

  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(filePath));
}

function getLargestMediaUrl(mediaList) {
  if (!Array.isArray(mediaList) || mediaList.length === 0) {
    return null;
  }

  const sorted = [...mediaList].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0]?.url || null;
}

function getFileNameFromUrl(url, fallbackName) {
  try {
    const parsed = new URL(url);
    const baseName = path.basename(parsed.pathname);
    if (baseName && baseName !== '/') {
      return baseName;
    }
  } catch (error) {
    // URL parsing can fail for malformed sources; fallback below.
  }

  return fallbackName;
}

function collectMediaFromHtml(html, imageUrls, videoUrls) {
  if (!html) return;

  const imageRegex = /<img[^>]+src="([^"]+)"/g;
  const tumblrVideoRegex = /<video[^>]+src="([^"]+)"/g;
  const youtubeRegex = /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s"'<>]+/g;

  let match;
  while ((match = imageRegex.exec(html)) !== null) {
    imageUrls.add(match[1]);
  }

  while ((match = tumblrVideoRegex.exec(html)) !== null) {
    videoUrls.add(match[1]);
  }

  while ((match = youtubeRegex.exec(html)) !== null) {
    videoUrls.add(match[0]);
  }
}

function collectMediaFromContentBlocks(blocks, imageUrls, videoUrls) {
  if (!Array.isArray(blocks)) return;

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;

    if (block.type === 'image') {
      const imageUrl = getLargestMediaUrl(block.media) || block.url;
      if (imageUrl) imageUrls.add(imageUrl);
    }

    if (block.type === 'video') {
      const videoUrl = getLargestMediaUrl(block.media) || block.url;
      if (videoUrl) videoUrls.add(videoUrl);
    }

    if (block.type === 'text' && block.text) {
      collectMediaFromHtml(block.text, imageUrls, videoUrls);
    }
  }
}

function getNormalizedCaptionValue(value) {
  if (typeof value !== 'string') return '';
  const withoutHtml = value.replace(/<[^>]*>/g, ' ');
  return withoutHtml.replace(/\s+/g, ' ').trim();
}

function collectCaptionPartsFromBlocks(blocks, parts) {
  if (!Array.isArray(blocks)) return;

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;

    if (block.type === 'text') {
      if (block.text) parts.push(block.text);
      continue;
    }

    if (block.type === 'link') {
      if (block.title) parts.push(block.title);
      if (block.description) parts.push(block.description);
      continue;
    }

    if (block.type === 'image') {
      if (block.caption) parts.push(block.caption);
      if (block.alt_text) parts.push(block.alt_text);
    }
  }
}

function extractCaption(post) {
  const captionParts = [];

  if (post.caption) captionParts.push(post.caption);
  if (post.body) captionParts.push(post.body);

  collectCaptionPartsFromBlocks(post.content, captionParts);

  if (Array.isArray(post.trail)) {
    for (const trailItem of post.trail) {
      if (trailItem?.content_raw) {
        captionParts.push(trailItem.content_raw);
      }

      collectCaptionPartsFromBlocks(trailItem?.content, captionParts);
    }
  }

  for (const part of captionParts) {
    const normalized = getNormalizedCaptionValue(part);
    if (normalized) {
      return normalized;
    }
  }

  return 'No caption';
}

function extractMediaUrls(post) {
  const imageUrls = new Set();
  const videoUrls = new Set();

  if (Array.isArray(post.photos)) {
    for (const photo of post.photos) {
      const photoUrl = photo?.original_size?.url;
      if (photoUrl) imageUrls.add(photoUrl);
    }
  }

  if (post.video_url) {
    videoUrls.add(post.video_url);
  }

  collectMediaFromContentBlocks(post.content, imageUrls, videoUrls);

  if (Array.isArray(post.trail)) {
    for (const trailItem of post.trail) {
      collectMediaFromContentBlocks(trailItem?.content, imageUrls, videoUrls);
      collectMediaFromHtml(trailItem?.content_raw, imageUrls, videoUrls);
    }
  }

  collectMediaFromHtml(post.body, imageUrls, videoUrls);
  collectMediaFromHtml(post.caption, imageUrls, videoUrls);

  return {
    imageUrls: [...imageUrls],
    videoUrls: [...videoUrls]
  };
}

// Download media, preserving failures so the post can be retried.
async function downloadMedia(url, postDir, fileName, isVideo = false) {
  const filePath = path.join(postDir, fileName);
  if (fs.existsSync(filePath)) {
    console.log(`Skipping ${filePath}, already downloaded.`);
    return;
  }

  const temporaryPath = `${filePath}.part`;
  if (isVideo && (url.includes('youtube.com') || url.includes('youtu.be'))) {
    await pipeline(ytdl(url, { quality: 'highest' }), fs.createWriteStream(temporaryPath));
  } else {
    await downloadToFile(url, temporaryPath);
  }
  fs.renameSync(temporaryPath, filePath);
  console.log(`Downloaded ${filePath}`);
}

// Function to process each post and download associated media
async function processPost(post) {
  const postId = post.id;
  if (progress[postId]) {
    console.log(`Skipping post ${postId} (already backed up).`);
    return;
  }

  // Create a folder for the post
  const postDir = path.join(backupDir, String(postId));
  fs.mkdirSync(postDir, { recursive: true });

  // Save the caption and timestamp
  const caption = extractCaption(post);
  let timestamp;

  if (post.date) {
    timestamp = new Date(post.date);
    if (isNaN(timestamp)) {
      console.error(`Invalid timestamp for post ${post.id}, using current time instead.`);
      timestamp = new Date();
    }
  } else {
    console.error(`No timestamp available for post ${post.id}, using current time instead.`);
    timestamp = new Date();
  }

  const timestampString = timestamp.toISOString();
  const captionFile = path.join(postDir, 'caption.txt');
  fs.writeFileSync(captionFile, `Timestamp: ${timestampString}\nCaption:\n${caption}`);

  const { imageUrls, videoUrls } = extractMediaUrls(post);
  if (imageUrls.length === 0 && videoUrls.length === 0) {
    console.log(`No media URLs found for post ${postId}.`);
  }

  for (let i = 0; i < imageUrls.length; i += 1) {
    const imageUrl = imageUrls[i];
    const imageName = getFileNameFromUrl(imageUrl, `image_${i + 1}.jpg`);
    await downloadMedia(imageUrl, postDir, imageName);
  }

  for (let i = 0; i < videoUrls.length; i += 1) {
    const videoUrl = videoUrls[i];
    const videoName = getFileNameFromUrl(videoUrl, `video_${i + 1}.mp4`);
    await downloadMedia(videoUrl, postDir, videoName, true);
  }

  // Publish the checkpoint before marking the post complete in memory.
  const nextProgress = { ...progress, [postId]: { timestamp } };
  fs.writeFileSync(`${progressFile}.part`, JSON.stringify(nextProgress, null, 2));
  fs.renameSync(`${progressFile}.part`, progressFile);
  progress = nextProgress;
}

// Function to fetch blog posts from Tumblr
async function fetchPosts(offset = 0, limit = 20) {
  const result = await client.blogPosts(blogName, { offset, limit });
  return result.posts || [];
}

// Main backup function
async function backupBlog() {
  let offset = 0;
  const limit = 20;
  let posts;

  do {
    posts = await fetchPosts(offset, limit);

    if (posts.length === 0) break;

    for (const post of posts) {
      await processPost(post);
    }

    offset += limit;
  } while (posts.length === limit);

  console.log('Backup complete!');
}

// Run the backup
if (require.main === module) {
  backupBlog().catch((error) => {
    console.error('Error during backup:', error.message);
    process.exitCode = 1;
  });
}
