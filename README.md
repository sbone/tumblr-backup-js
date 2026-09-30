# tumblr-backup-js

Script to archive a Tumblr blog's photos and videos, generating a file structure like so:

```
tumblr_backup/
  ├── 1234567890/
  │   ├── caption.txt
  │   ├── post.json
  │   ├── image_1_original.jpg
  │   ├── image_2_original.jpg
  ├── 2345678901/
  │   ├── caption.txt
  │   ├── post.json
  │   ├── video_1_original.mp4
```

Progress is written to `progress.json` for resuming in case of interruption.

## Requirements

- Node.js 20.18.1+ for downloader compatibility and `--env-file` support
- A Tumblr application and OAuth 1.0a tokens
- Access to the private or password-protected blog you want to archive

## Setup

1. Create a Tumblr application at https://www.tumblr.com/oauth/apps.
2. Generate credentials for the account that can access the target blog.
3. Copy `.env.example` to `.env`.
4. Fill in `.env` with your Tumblr API key, API secret, OAuth token, OAuth token secret, and blog name.
5. Install dependencies with `npm install`.

## Configuration

Set these values in `.env`:

- `API_KEY`: your Tumblr consumer key
- `API_SECRET`: your Tumblr consumer secret
- `OAUTH_TOKEN`: your OAuth access token
- `OAUTH_TOKEN_SECRET`: your OAuth access token secret
- `BLOG_NAME`: the blog hostname, for example `example.tumblr.com`

The script uses OAuth because private and password-protected blogs are not safely handled by an API-key-only flow.

## Usage

Run:

```bash
npm run backup
```

The script will:

- create `tumblr_backup/` if needed
- fetch posts from the configured blog in batches
- write each post into its own directory
- save progress to `progress.json` after every post so interrupted runs can resume

## Notes

- Existing downloaded files are skipped.
- Downloads use `.part` files and are renamed only after success; interrupted downloads are retried.
- Failed downloads or API requests stop the run with a nonzero exit status. A post is marked complete only after all its media downloads succeed.
- `post.json` preserves the full post returned by Tumblr, including formatting, tags, and reblog trail; `caption.txt` is a short readable summary.
- YouTube URLs are still downloaded through `@distube/ytdl-core`.
- If you change `BLOG_NAME`, remove or rename `progress.json` unless you want to reuse the old progress state.

If upgrading from the original script, rename the old `progress.json` before running again to recheck posts previously marked complete and add `post.json`. Media will download again under the new indexed filenames; old files are retained. The script cannot detect incomplete files or missing media recorded as successful by the old version.

Run the offline regression tests with `npm test`. They use temporary directories and simulated HTTP, YouTube, and Tumblr responses; no credentials are needed.
