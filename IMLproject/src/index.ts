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
} from '@marcellejs/core';

const dash = dashboard({ title: 'Art Reference Suggester', author: 'You' });
const store = dataStore('memory'); // or 'localStorage'/'indexedDB' for persistence

const imageDataset = dataset('TrainingSet', store);
const choiceDataset = dataset('Choices', store);
const suggestedDataset = dataset('SuggestedLiked', store);

// ── Debug logs ────────────────────────────────────────────────
imageDataset.$count.subscribe(count => console.log(`Main dataset: ${count} instances`));

// ── LOADING DATASET FROM SERVER ───────────────────────────────
const staticBase = 'http://localhost:8000';

async function importAllFromServer() {
  await new Promise(r => setTimeout(r, 1000));
  try {
    const resp = await fetch(`${staticBase}/index.json`);
    if (!resp.ok) throw new Error("index.json not found");
    const allInstances = await resp.json();
    console.log(`Found ${allInstances.length} images`);

    const currentCount = await imageDataset.$count.get();
    if (currentCount >= allInstances.length) return;

    let added = 0;
    for (const inst of allInstances) {
      inst.x = new URL(inst.x, staticBase).href;
      inst.thumbnail = new URL(inst.thumbnail, staticBase).href;
      try {
        await imageDataset.create(inst);
        added++;
      } catch (e) {
        console.warn("Skip:", inst.x, e);
      }
    }
    console.log(`Imported ${added} images`);
  } catch (err) {
    console.error("Import failed:", err);
  }
}
importAllFromServer();

// ── URL → ImageData helper ────────────────────────────────────
async function urlToImageData(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ── DISPLAY & LABELING ────────────────────────────────────────
const browser = datasetBrowser(imageDataset);
const choicebrowser = datasetBrowser(choiceDataset);
const suggestedBrowser = datasetBrowser(suggestedDataset);

const selectedImageStream = browser.$selected
  .map(async (ids) => {
    if (!ids?.length) return null;
    try {
      const item = await imageDataset.get(ids[0]);
      return item?.x ? await urlToImageData(item.x) : null;
    } catch {
      return null;
    }
  })
  .awaitPromises();

const preview = imageDisplay(selectedImageStream);
preview.title = 'Image Preview';

const likeBtn = button('Like');
const dislikeBtn = button('Dislike');

// Feature extractor (used at labeling time + suggestion time)
const featureExtractor = mobileNet({ version: 2, alpha: 0.5 });

async function storeDecision(label) {
  const ids = browser.$selected.get();
  if (!ids?.length) {
    console.warn('No image selected');
    return;
  }

  try {
    const item = await imageDataset.get(ids[0]);
    if (!item) return;

    // Extract embedding NOW (inspired by sketch example)
    const imgData = await urlToImageData(item.x);
    const embedding = await featureExtractor.process(imgData);

    await choiceDataset.create({
      sourceId: item.id,
      x: embedding,                   // ← number[] features (required for train)
      thumbnail: item.thumbnail,
      originalLabel: item.y || 'unknown',
      y: label,                       // 'liked' / 'disliked'
      validation: label,
      reviewedAt: new Date().toISOString(),
    });

    console.log(`Labeled ${item.id} as ${label} (embedding stored)`);
  } catch (err) {
    console.error('Store failed:', err);
  }
}

likeBtn.$click.subscribe(() => storeDecision('liked'));
dislikeBtn.$click.subscribe(() => storeDecision('disliked'));

// ── PREFERENCE MODEL ──────────────────────────────────────────
const classifier = mlpClassifier({
  layers: [128, 64],
  epochs: 30,
  batchSize: 8,
});

const trainBtn = button('Train Preference Model');
const suggestBtn = button('Generate Liked Suggestions');
const statusText = text('Model status: Not trained yet');

classifier.$training.subscribe((s) => {
  if (s.status === 'start') statusText.$value.set('Training...');
  else if (s.status === 'epoch') statusText.$value.set(`Epoch ${s.epoch} — loss: ${s.loss?.toFixed(3) ?? '–'}`);
  else if (s.status === 'success') statusText.$value.set('✅ Trained!');
  else if (s.status === 'error') statusText.$value.set('❌ Failed');
});

trainBtn.$click.subscribe(async () => {
  statusText.$value.set('Checking choices...');
  const count = await choiceDataset.$count.get();
  if (count < 6) {
    statusText.$value.set('Need ≥6 examples');
    return;
  }
  statusText.$value.set('Training on choices...');
  try {
    await classifier.train(choiceDataset);  // ← works because x = embedding[]
    statusText.$value.set('Training done!');
  } catch (err) {
    console.error('Train error:', err);
    statusText.$value.set('Training error — check console');
  }
});

// ── GENERATE SUGGESTIONS (manual inference loop) ──────────────
async function getAll(ds) {
  return await ds.items().toArray();  // should work now (docs confirm this pattern)
}

async function clearDataset(ds) {
  const items = await getAll(ds);
  for (const item of items) await ds.delete(item.id);
}

suggestBtn.$click.subscribe(async () => {
  statusText.$value.set('Clearing old suggestions...');
  await clearDataset(suggestedDataset);

  const choices = await getAll(choiceDataset);
  const chosenIds = new Set(choices.map(c => c.sourceId));

  const allImages = await getAll(imageDataset);
  statusText.$value.set(`Classifying ${allImages.length} images...`);

  let added = 0;
  for (const img of allImages) {
    if (chosenIds.has(img.id)) continue;

    try {
      const imgData = await urlToImageData(img.x);
      const embedding = await featureExtractor.process(imgData);

      const pred = await classifier.predict(embedding);  // number[] → works

      if (pred.label === 'liked' && pred.confidences.liked > 0.65) {
        await suggestedDataset.create({
          ...img,
          predicted: 'liked',
          confidence: pred.confidences.liked,
          y: `liked (${(pred.confidences.liked * 100).toFixed(0)}%)`,
        });
        added++;
      }
    } catch (e) {
      console.warn('Skip', img.id, e);
    }
  }
  statusText.$value.set(`${added} new liked suggestions!`);
});

// ── DASHBOARD ─────────────────────────────────────────────────
dash.page('Data Management')
  .use(browser, choicebrowser,statusText, suggestedBrowser)
  .sidebar(preview, likeBtn, dislikeBtn, trainBtn, suggestBtn, );

dash.show();
