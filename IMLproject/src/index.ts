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
const store = dataStore('memory');

const imageDataset     = dataset('TrainingSet', store);
const choiceDataset    = dataset('Choices', store);
const suggestedDataset = dataset('Suggested', store);

// ── Debug counts ─────────────────────────────────────────────────────
imageDataset.$count.subscribe(count => 
  console.log(`Main dataset: ${count} instances`)
);
suggestedDataset.$count.subscribe(count => 
  console.log(`Suggested dataset: ${count} instances`)
);
choiceDataset.$count.subscribe(count => 
  console.log(`Choices dataset: ${count} instances`)
);

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
const browser         = datasetBrowser(imageDataset);
const choicebrowser   = datasetBrowser(choiceDataset);
const suggestedBrowser = datasetBrowser(suggestedDataset);

// ── SHARED CURRENT SELECTION (simple variable) ───────────────────────
let currentSelection: { dataset: any; id: string } | null = null;

// Update when main browser selection changes
browser.$selected.subscribe(ids => {
  if (ids?.length) {
    currentSelection = { dataset: imageDataset, id: ids[0] };
    console.log('Current selection → main dataset', ids[0]);
  }
});

// Update when suggested browser selection changes (takes priority)
suggestedBrowser.$selected.subscribe(ids => {
  if (ids?.length) {
    currentSelection = { dataset: suggestedDataset, id: ids[0] };
    console.log('Current selection → suggested dataset', ids[0]);
  }
});

// ── PREVIEW STREAMS ──────────────────────────────────────────────────
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
    console.log(`Trying to load suggested item: ${ids[0]}`);
    try {
      const item = await suggestedDataset.get(ids[0]);
      return item?.x ? await urlToImageData(item.x) : null;
    } catch (err) {
      console.error('Failed to load suggested item:', err);
      return null;
    }
  })
  .awaitPromises();

const preview1 = imageDisplay(selectedImageStream1);
preview1.title = 'Main Image Preview';

const preview2 = imageDisplay(selectedImageStream2);
preview2.title = 'Suggested Image Preview';

// ── LABELING ─────────────────────────────────────────────────────────
const likeBtn    = button('Like');
const dislikeBtn = button('Dislike');

const featureExtractor = mobileNet({ version: 2, alpha: 0.5 });

async function storeDecision(label: 'liked' | 'disliked') {
  const sel = currentSelection;
  if (!sel?.id || !sel.dataset) {
    console.warn('No image currently selected – please select one first');
    return;
  }

  try {
    const item = await sel.dataset.get(sel.id);
    const imgData = await urlToImageData(item.x);
    const embedding = await featureExtractor.process(imgData);

    const originalId = item.originalId || item.id;

    await choiceDataset.create({
      id: originalId,           // reuse meaningful id if possible
      x: embedding,
      thumbnail: item.thumbnail,
      originalId,
      originalLabel: item.y || 'unknown',
      y: label,
      reviewedAt: new Date().toISOString(),
      sourceDataset: sel.dataset.name || 'unknown',
    });

    console.log(`Labeled ${originalId} as ${label} (from ${sel.dataset.name})`);

  } catch (err) {
    console.error('Failed to store decision:', err);
  }
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
const suggestBtn = button('Generate Suggestions');
const statusText = text('Model status: Not trained yet');

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

// ── HELPERS ──────────────────────────────────────────────────────────
async function getAll(ds: any) {
  return await ds.items().toArray();
}

async function clearDataset(ds: any) {
  const items = await ds.items().toArray();
  for (const item of items) {
    await ds.remove(item.id);
  }
  console.log(`${ds.name} cleared`);
}

// ── GENERATE SUGGESTIONS ─────────────────────────────────────────────
suggestBtn.$click.subscribe(async () => {
  statusText.$value.set('Generating suggestions...');

	clearDataset(suggestedDataset);

  const choices = await getAll(choiceDataset);
  const chosenIds = new Set(choices.map(c => c.originalId));

  const allImages = await getAll(imageDataset);

  for (const img of allImages) {
    if (chosenIds.has(img.id)) continue;

    const imgData = await urlToImageData(img.x);
    const embedding = await featureExtractor.process(imgData);
    const pred = await classifier.predict(embedding);
    const confLiked = pred.confidences.liked ?? 0;

    if (pred.label === 'liked' && confLiked > 0.7) {
      await suggestedDataset.create({
        id: img.id,           // keep original id → consistent & easier debugging
        x: img.x,
        thumbnail: img.thumbnail,
        originalId: img.id,
        predicted: 'liked',
        confidence: confLiked,
        y: 'liked',
      });
      console.log(`Suggested image ${img.id} (conf: ${confLiked.toFixed(3)})`);
    }
  }
  statusText.$value.set('Suggestions ready!');
});

// ── DASHBOARD LAYOUT ─────────────────────────────────────────────────
dash.page('Data & Labeling')
  .use(browser, choicebrowser)
  .sidebar(preview1, likeBtn, dislikeBtn);

dash.page('Suggestions')
  .use([trainBtn, suggestBtn], statusText, suggestedBrowser)
  .sidebar(preview2, likeBtn, dislikeBtn);

dash.show();
