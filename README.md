# tumblr-backup-js

Script to archive a Tumblog's photos and videos, generating a file structure like so:

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

## Setup

1. Create your Tumblr tokens: https://www.tumblr.com/oauth/apps
2. `cp .env.example .env`
3. Fill in `.env` with said tokens
4. `npm install`

## Usage

1. `npm run backup`