# tumblr-backup-js

Script to archive a Tumblr blog's photos and videos, generating a file structure like so:

```
tumblr_backup/
  ├── 1234567890/
  │   ├── caption.txt
  │   ├── image1.jpg
  │   ├── image2.jpg
  ├── 2345678901/
  │   ├── caption.txt
  │   ├── video.mp4
```

Progress is written to `progress.json` for resuming in case of interruption.

## Requirements

- Node.js 20.6+ for `--env-file` support
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
- YouTube URLs are still downloaded through `@distube/ytdl-core`.
- If you change `BLOG_NAME`, remove or rename `progress.json` unless you want to reuse the old progress state.
