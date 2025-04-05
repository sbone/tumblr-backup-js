require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const tumblr = require('tumblr.js');
const mkdirp = require('mkdirp');
const https = require('https');

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
mkdirp.sync(backupDir);

// Function to download an image
async function downloadImage(url, postId, postDir, imageName) {
  const filePath = path.join(postDir, imageName);

  // Skip if the image is already downloaded
  if (fs.existsSync(filePath)) {
    console.log(`Skipping ${filePath}, already downloaded.`);
    return;
  }

  try {
    const response = await axios.get(url, { responseType: 'stream' });
    const writer = fs.createWriteStream(filePath);

    response.data.pipe(writer);
    writer.on('finish', () => {
      console.log(`Downloaded ${filePath}`);
    });
  } catch (error) {
    console.error(`Error downloading ${url}:`, error.message);
  }
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
  mkdirp.sync(postDir);

  // Save the caption and timestamp
  const caption = post.caption || 'No caption';
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

  // Download images if the post has any
  if (post.photos) {
    for (const photo of post.photos) {
      const photoUrl = photo.original_size.url;
      const imageName = path.basename(photoUrl); // Use the image URL to get the file name
      await downloadImage(photoUrl, postId, postDir, imageName);
    }
  }

  // Mark the post as backed up
  progress[postId] = { timestamp };

  // Save progress after every post
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
}

// Function to fetch blog posts from Tumblr
async function fetchPosts(offset = 0, limit = 20) {
  try {
    const result = await client.blogPosts(blogName, { offset, limit });
    return result.posts || [];
  } catch (error) {
    console.error('Error fetching posts:', error.message);
    return [];
  }
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
backupBlog().catch((error) => {
  console.error('Error during backup:', error.message);
});
