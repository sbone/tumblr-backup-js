# tumblr-backup-js

Script to archive a photo-based Tumblog, generating a file structure like so:

```
tumblr_backup/
  ├── 1234567890/
  │   ├── caption.txt
  │   ├── image1.jpg
  │   ├── image2.jpg
  ├── 2345678901/
  │   ├── caption.txt
  │   ├── image1.jpg
  │   ├── image3.jpg
```

## Setup

1. Create your Tumblr tokens: https://www.tumblr.com/oauth/apps
2. `cp .env.example .env`
3. Fill in `.env` with said tokens
4. `npm install`

## Usage

1. `npm run backup`