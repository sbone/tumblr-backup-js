const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
const post = { id: 1, date: '2020-01-01', photos: [
  { original_size: { url: 'https://example.com/image.jpg' } }
] };

function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tumblr-backup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const disk = Object.create(fs);
  for (const method of ['existsSync', 'mkdirSync', 'readFileSync', 'writeFileSync', 'createWriteStream', 'unlinkSync']) {
    disk[method] = (file, ...args) => fs[method](path.resolve(dir, file), ...args);
  }
  disk.renameSync = (from, to) => fs.renameSync(path.resolve(dir, from), path.resolve(dir, to));
  Object.assign(disk, options.fs);
  const logs = [];
  const runtime = { env: {}, exitCode: undefined };
  const entry = {};
  const requireStub = name => {
    if (name === 'fs') return disk;
    if (name === 'tumblr.js') return { createClient: () => ({ blogPosts: options.blogPosts || (async () => ({ posts: [] })) }) };
    if (name === '@distube/ytdl-core') return options.ytdl;
    return require(name);
  };
  requireStub.main = options.main ? entry : {};
  const context = vm.createContext({ require: requireStub, module: entry, process: runtime,
    fetch: options.fetch || (async () => new Response('image')),
    console: { log: message => logs.push(message), error() {} } });
  vm.runInContext(source, context);
  return { dir, logs, runtime, run: expression => vm.runInContext(expression, context) };
}

test('HTTP download failure leaves the post retryable', async t => {
  let fail = true;
  const app = setup(t, { fetch: async () => new Response('image', { status: fail ? 503 : 200 }) });
  await assert.rejects(app.run(`processPost(${JSON.stringify(post)})`), /503/);
  assert.equal(fs.existsSync(path.join(app.dir, 'progress.json')), false);
  fail = false;
  await app.run(`processPost(${JSON.stringify(post)})`);
  assert.ok(JSON.parse(fs.readFileSync(path.join(app.dir, 'progress.json')))[1]);
});

test('YouTube download failure leaves the post retryable', async t => {
  const app = setup(t, { ytdl: () => Readable.from((async function* () { throw new Error('video failed'); })()) });
  await assert.rejects(app.run("processPost({id: 1, date: '2020-01-01', video_url: 'https://youtu.be/abc'})"), /video failed/);
  assert.equal(fs.existsSync(path.join(app.dir, 'progress.json')), false);
});

test('API failure rejects the backup without reporting completion', async t => {
  const app = setup(t, { blogPosts: async () => { throw new Error('API unavailable'); } });
  await assert.rejects(app.run('backupBlog()'), /API unavailable/);
  assert.equal(app.logs.includes('Backup complete!'), false);
});

test('command failure sets a nonzero exit status', async t => {
  const app = setup(t, { main: true, blogPosts: async () => { throw new Error('API unavailable'); } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.runtime.exitCode, 1);
});

for (const youtube of [false, true]) {
  test(`${youtube ? 'YouTube' : 'HTTP'} interrupted stream never publishes a partial file`, async t => {
    let fail = true;
    const brokenStream = () => Readable.from((async function* () {
      yield 'partial';
      await new Promise(resolve => setImmediate(resolve));
      throw new Error('interrupted');
    })());
    const app = setup(t, {
      fetch: async () => fail ? new Response(Readable.toWeb(brokenStream())) : new Response('complete'),
      ytdl: () => fail ? brokenStream() : Readable.from(['complete'])
    });
    const url = youtube ? 'https://youtu.be/abc' : 'https://example.com/image.jpg';
    const download = `downloadMedia('${url}', './tumblr_backup', 'media.bin', ${youtube})`;
    await assert.rejects(app.run(download), /interrupted/);
    const destination = path.join(app.dir, 'tumblr_backup/media.bin');
    assert.equal(fs.existsSync(destination), false);
    // A stale temporary file from a killed process must also be overwritten.
    fs.writeFileSync(`${destination}.part`, 'stale');
    fail = false;
    await app.run(download);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'complete');
    assert.equal(fs.existsSync(`${destination}.part`), false);
    fail = true;
    await app.run(download); // Completed files still skip the network.
  });
}

test('interrupted progress write preserves the previous checkpoint', async t => {
  let fail = false;
  let app;
  app = setup(t, { fs: { writeFileSync(file, data) {
    const destination = path.resolve(app.dir, file);
    if (fail && file.startsWith('./progress.json')) {
      fs.writeFileSync(destination, '{');
      throw new Error('disk full');
    }
    fs.writeFileSync(destination, data);
  } } });
  await app.run("processPost({id: 1, date: '2020-01-01'})");
  const checkpoint = path.join(app.dir, 'progress.json');
  const previous = fs.readFileSync(checkpoint, 'utf8');
  fail = true;
  await assert.rejects(app.run("processPost({id: 2, date: '2020-01-01'})"), /disk full/);
  assert.equal(fs.readFileSync(checkpoint, 'utf8'), previous);
  assert.equal(app.run('Boolean(progress[2])'), false);
  fail = false;
  await app.run("processPost({id: 2, date: '2020-01-01'})");
  assert.ok(JSON.parse(fs.readFileSync(checkpoint))[2]);
});
