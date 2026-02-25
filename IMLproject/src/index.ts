import '@marcellejs/core/dist/marcelle.css';
import {
  dataset,
  dataStore,
  dashboard,
  datasetTable,
  datasetBrowser,
  imageDisplay,
  button,
} from '@marcellejs/core';

const dash = dashboard({ title: 'Art Reference Suggester', author: 'You' });

const store = dataStore('memory');
const imageDataset = dataset('TrainingSet', store);
const choiceDataset = dataset('Choices', store); 

// Debug logs
imageDataset.$count.subscribe(count => {
  console.log(`Dataset contains ${count} instances`);
});
imageDataset.$changes.subscribe(changes => {
  console.log('Dataset changes:', changes);
});

// ==================== LOADING DATASET ====================
const staticBase = 'http://localhost:8000';
async function importAllFromServer() {
  await new Promise(r => setTimeout(r, 1000)); // give backend time
  try {
    const resp = await fetch(`${staticBase}/index.json`);
    if (!resp.ok) throw new Error("index.json not found");
    const allInstances = await resp.json();
    console.log(`Found ${allInstances.length} images in index`);
    const currentCount = await imageDataset.$count.get();
    if (currentCount >= allInstances.length) {
      console.log("Dataset already seems populated — skipping");
      return;
    }
    let added = 0;
    for (const inst of allInstances) {
      inst.x = new URL(inst.x, staticBase).href;
      inst.thumbnail = new URL(inst.thumbnail, staticBase).href;
     
      try {
        await imageDataset.create(inst);
        added++;
      } catch (e) {
        console.warn("Skip duplicate / failed:", inst.x, e);
      }
    }
    console.log(`Imported ${added} new instances`);
  } catch (err) {
    console.error("Import failed:", err);
  }
}
importAllFromServer();

// ==================== Helper: URL → ImageData (FIXED for CORS) ====================
async function urlToImageData(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';   // ← THIS FIXES THE "insecure" ERROR
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = (e) => {
      console.error(`Failed to load image for preview (CORS / network issue): ${url}`, e);
      reject(e);
    };
    img.src = url;
  });
}

// ==================== DISPLAY DATASET & Input ====================
const browser = datasetBrowser(imageDataset);
const choicebrowser = datasetBrowser(choiceDataset);

const selectedImageStream = browser.$selected
  .map(async (ids) => {
    console.log("Mapping selected ids:", ids);
    if (!ids || ids.length === 0) {
      console.log("→ no selection, returning null");
      return null;
    }
    try {
      const item = await imageDataset.get(ids[0]);
      console.log("Fetched item:", item);
      if (!item || !item.x) {
        console.log("→ item or item.x missing");
        return null;
      }
      console.log("→ converting to ImageData for preview:", item.x);
      return await urlToImageData(item.x);
    } catch (err) {
      console.error("get() or image conversion failed", err);
      return null;
    }
  })
  .awaitPromises();

// ================= Image Preview ==================
const preview = imageDisplay(selectedImageStream);
preview.title = 'Image Preview';

const likeBtn = button('like');
const dislikeBtn = button('dislike');

async function storeDecision(label) {
  const ids = browser.$selected.get();
  if (!ids || ids.length === 0) {
    console.warn('No selected picture');
    return;
  }
  try {
    const item = await imageDataset.get(ids[0]);
    if (!item) {
      console.warn('selected item not found');
      return;
    }
    await choiceDataset.create({
      sourceId: item.id,
      thumbnail: item.thumbnail,
      originalLabel: item.y,
      y: label,
      reviewedAt: new Date().toISOString(),
    });
    console.log(`Stored ${item.id} with ${label}`);
  } catch (err) {
    console.error(`Failed to store decision:`, err);
  }
}

likeBtn.$click.subscribe(() => storeDecision('liked'));
dislikeBtn.$click.subscribe(() => storeDecision('disliked'));

const table = datasetTable(imageDataset, ['thumbnail', 'y']);

dash.page('Data Management')
  .use(browser, choicebrowser) 
  .sidebar(preview,likeBtn, dislikeBtn);

dash.show();
