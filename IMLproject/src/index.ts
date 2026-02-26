import '@marcellejs/core/dist/marcelle.css';
import {
  dataset,
  dataStore,
  dashboard,
  datasetBrowser,
  imageDisplay,
  button,
  text,
  mobileNet,
  mlpClassifier,
  imageUpload,
  slider,
} from '@marcellejs/core';

// ── DASHBOARD & STORE ────────────────────────────────────────────────
const dash = dashboard({ title: 'Art Reference Suggester', author: 'You' });
const store = dataStore('memory');

const imageDataset     = dataset('TrainingSet', store);
const choiceDataset    = dataset('Choices', store);
const suggestedDataset = dataset('Suggested', store);

// ── LOAD DATA FROM SERVER ────────────────────────────────────────────
const staticBase = 'http://localhost:8000';

async function importAllFromServer() {
  await new Promise(r => setTimeout(r, 1000));
  const resp = await fetch(`${staticBase}/index.json`);
  if (!resp.ok) throw new Error("index.json not found");

  const allInstances = await resp.json();
  const currentCount = await imageDataset.$count.get();
  if (currentCount >= allInstances.length) return;

  for (const inst of allInstances) {
    inst.x = new URL(inst.x, staticBase).href;
    inst.thumbnail = new URL(inst.thumbnail, staticBase).href;
    await imageDataset.create(inst);
  }
  console.log(`Imported ${allInstances.length} images`);
}
importAllFromServer();

// ── URL → ImageData ──────────────────────────────────────────────────
async function urlToImageData(url: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ── DATASET BROWSERS ─────────────────────────────────────────────────
const browser          = datasetBrowser(imageDataset);
browser.title = "Image Browser";
const choicebrowser    = datasetBrowser(choiceDataset);
choicebrowser.title = "Your Data";
const suggestedBrowser = datasetBrowser(suggestedDataset);
suggestedBrowser.title = "Model Suggestions";

// ── IMAGE PREVIEWS ───────────────────────────────────────────────────
const selectedImageStream1 = browser.$selected
  .map(async (ids) => {
    if (!ids?.length) return null;
    const item = await imageDataset.get(ids[0]);
    return item?.x ? await urlToImageData(item.x) : null;
  })
  .awaitPromises();

const selectedImageStream2 = suggestedBrowser.$selected
  .map(async (ids) => {
    if (!ids?.length) return null;
    const item = await suggestedDataset.get(ids[0]);
    return item?.x ? await urlToImageData(item.x) : null;
  })
  .awaitPromises();

const preview1 = imageDisplay(selectedImageStream1);
preview1.title = 'Main Image Preview';

const preview2 = imageDisplay(selectedImageStream2);
preview2.title = 'Suggested Image Preview';

// ── IMAGE UPLOAD ─────────────────────────────
const upload = imageUpload({ width: 256, height: 256 });
upload.title = 'Upload Reference';

// ── FEATURE EXTRACTOR ────────────────────────────────────────────────
const featureExtractor = mobileNet({ version: 2, alpha: 0.5 });

// Convert uploaded images directly into liked training samples
upload.$images.subscribe(async (imgData) => {
  if (!imgData) return;

  const embedding = await featureExtractor.process(imgData);
  const id = `upload-${Date.now()}`;

  await choiceDataset.create({
    id,
    x: embedding,
    y: 'liked',
    thumbnail: upload.$thumbnails.get(),
    originalId: id,
    originalLabel: 'user-upload',
    reviewedAt: new Date().toISOString(),
    sourceDataset: 'imageUpload',
  });

  console.log(`Stored uploaded image as liked (${id})`);
});

// ── LABEL BUTTONS ────────────────────────────────────────────────────
let currentSelection: { dataset: any; id: string } | null = null;

browser.$selected.subscribe(ids => {
  if (ids?.length) currentSelection = { dataset: imageDataset, id: ids[0] };
});
suggestedBrowser.$selected.subscribe(ids => {
  if (ids?.length) currentSelection = { dataset: suggestedDataset, id: ids[0] };
});

const likeBtn    = button('Like');
likeBtn.title = "";
const dislikeBtn = button('Dislike');
dislikeBtn.title = "";

async function storeDecision(label: 'liked' | 'disliked') {
  const sel = currentSelection;
  if (!sel) return;

  const item = await sel.dataset.get(sel.id);
  const imgData = await urlToImageData(item.x);
  const embedding = await featureExtractor.process(imgData);

  await choiceDataset.create({
    id: item.id,
    x: embedding,
    thumbnail: item.thumbnail,
    originalId: item.id,
    originalLabel: item.y || 'unknown',
    y: label,
    reviewedAt: new Date().toISOString(),
  });

  console.log(`Labeled ${item.id} as ${label}`);
}

likeBtn.$click.subscribe(() => storeDecision('liked'));
dislikeBtn.$click.subscribe(() => storeDecision('disliked'));

// ── MODEL ────────────────────────────────────────────────────────────
const classifier = mlpClassifier({
  layers: [128, 64],
  epochs: 30,
  batchSize: 8,
});

const trainBtn = button('Train Preference Model');
trainBtn.title = "";
const suggestBtn = button('Generate Suggestions');
suggestBtn.title = "";
const statusText = text('Model status: Not trained yet');

// ── CONFIDENCE SLIDER ────────────────────────────────────────────────
let confidenceThreshold = 0.7;

const thresholdSlider = slider({
  values: [0.7],
  min: 0,
  max: 1,
  step: 0.01,
  range: 'min',
  float: true,
  pips: true,
  formatter: (x) => `${Math.round(Number(x) * 100)}%`,
});
thresholdSlider.title = "Confidence Threshold";

thresholdSlider.$values.subscribe(v => {
  const parsed = JSON.parse(v as string);
  confidenceThreshold = Array.isArray(parsed) ? parsed[0] : parsed;
});

// ── TRAINING ─────────────────────────────────────────────────────────
trainBtn.$click.subscribe(async () => {
  const count = await choiceDataset.$count.get();
  if (count < 6) {
    statusText.$value.set('Need ≥6 examples to train');
    return;
  }
  statusText.$value.set('Training...');
  await classifier.train(choiceDataset);
  statusText.$value.set('Training complete!');
});

// ── SUGGESTIONS ──────────────────────────────────────────────────────
async function getAll(ds: any) {
  return await ds.items().toArray();
}

async function clearDataset(ds: any) {
  const items = await ds.items().toArray();
  for (const item of items) await ds.remove(item.id);
}

suggestBtn.$click.subscribe(async () => {
  statusText.$value.set('Generating suggestions...');
  await clearDataset(suggestedDataset);

  const choices = await getAll(choiceDataset);
  const chosenIds = new Set(choices.map(c => c.originalId));
  const allImages = await getAll(imageDataset);

  for (const img of allImages) {
    if (chosenIds.has(img.id)) continue;

    const imgData = await urlToImageData(img.x);
    const embedding = await featureExtractor.process(imgData);
    const pred = await classifier.predict(embedding);
    const confLiked = pred.confidences.liked ?? 0;

    if (pred.label === 'liked' && confLiked > confidenceThreshold) {
      await suggestedDataset.create({
        id: img.id,
        x: img.x,
        thumbnail: img.thumbnail,
        confidence: confLiked,
        y: 'liked',
      });
    }
  }

  statusText.$value.set('Suggestions ready!');
});

// ── DASHBOARD LAYOUT ─────────────────────────────────────────────────
dash.page('Data & Labeling')
  .use(choicebrowser, browser )
  .sidebar(preview1, likeBtn, dislikeBtn, upload);

dash.page('Suggestions')
  .use(choicebrowser, [trainBtn, suggestBtn], thresholdSlider, statusText, suggestedBrowser)
  .sidebar(preview2, likeBtn, dislikeBtn);

dash.show();
