const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { joinImages } = require('join-images');

const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const sanitize = require('sanitize-filename');

const {
  adjustCanvas,
  createFolder,
  parseImage,
  errorSerialize
} = require('./utils');

const {
  getValueOrDefault
} = require('./utils-browser');

let CYPRESS_SCREENSHOT_DIR;

function setupScreenshotPath(config) {
  // use cypress default path as fallback
  CYPRESS_SCREENSHOT_DIR = getValueOrDefault(config === null || config === void 0 ? void 0 : config.screenshotsFolder, 'cypress/screenshots');
}
/** Move the generated snapshot .png file to its new path.
 * The target path is constructed from parts at runtime in node to be OS independent.  */


async function moveSnapshot(args) {
  const {
    fromPath,
    specDirectory,
    fileName
  } = args;
  const destDir = path.join(CYPRESS_SCREENSHOT_DIR, specDirectory);
  const destFile = path.join(destDir, fileName);
  return createFolder(destDir, false).then(() => fsp.rename(fromPath, destFile)).then(() => null);
}
/** Update the base snapshot .png by copying the generated snapshot to the base snapshot directory.
 * The target path is constructed from parts at runtime in node to be OS independent.  */


async function updateSnapshot(args) {
  const {
    name,
    screenshotsFolder,
    snapshotBaseDirectory,
    specDirectory
  } = args;
  const toDir = getValueOrDefault(snapshotBaseDirectory, path.join(process.cwd(), 'cypress', 'snapshots', 'base'));
  const snapshotActualDirectory = getValueOrDefault(screenshotsFolder, 'cypress/screenshots');
  const destDir = path.join(toDir, specDirectory);
  const fromPath = path.join(snapshotActualDirectory, specDirectory, `${name}-actual.png`);
  const destFile = path.join(destDir, `${name}-base.png`);
  return createFolder(destDir, false).then(() => fsp.copyFile(fromPath, destFile)).then(() => null);
}
/** Cypress plugin to compare image snapshots & generate a diff image.
 *
 * Uses the pixelmatch library internally.
 */


async function compareSnapshotsPlugin(args) {
  const snapshotBaseDirectory = getValueOrDefault(args.baseDir, path.join(process.cwd(), 'cypress', 'snapshots', 'base'));
  const snapshotDiffDirectory = getValueOrDefault(args.diffDir, path.join(process.cwd(), 'cypress', 'snapshots', 'diff'));
  const alwaysGenerateDiff = !(args.keepDiff === false);
  //const allowVisualRegressionToFail = args.allowVisualRegressionToFail === true;
  const fileName = sanitize(args.fileName);
  const options = {
    actualImage: path.join(CYPRESS_SCREENSHOT_DIR, args.specDirectory, `${fileName}-actual.png`),
    expectedImage: path.join(snapshotBaseDirectory, args.specDirectory, `${fileName}-base.png`),
    diffImage: path.join(snapshotDiffDirectory, args.specDirectory, `${fileName}-diff.png`), 
    filename: fileName,
    specName: args.specName
  };
  let mismatchedPixels = 0;
  let percentage = 0;

  try {
    await createFolder(snapshotDiffDirectory, args.failSilently);
    const imgExpected = await parseImage(options.expectedImage);
    const imgActual = await parseImage(options.actualImage);
    const diff = new PNG({
      width: Math.max(imgActual.width, imgExpected.width),
      height: Math.max(imgActual.height, imgExpected.height)
    });
    const imgActualFullCanvas = adjustCanvas(imgActual, diff.width, diff.height);
    const imgExpectedFullCanvas = adjustCanvas(imgExpected, diff.width, diff.height);
    mismatchedPixels = pixelmatch(imgActualFullCanvas.data, imgExpectedFullCanvas.data, diff.data, diff.width, diff.height, {
      threshold: 0.1
    });
    percentage = (mismatchedPixels / diff.width / diff.height) ** 0.5;

    if (percentage > args.errorThreshold) {
      const specFolder = path.join(snapshotDiffDirectory, args.specDirectory);
      await createFolder(specFolder, args.failSilently);
      diff.pack().pipe(fs.createWriteStream(options.diffImage));
    } else if (alwaysGenerateDiff) {
      const specFolder = path.join(snapshotDiffDirectory, args.specDirectory);
      await createFolder(specFolder, args.failSilently);
      diff.pack().pipe(fs.createWriteStream(options.diffImage));
    }
  } catch (error) {
    return {
      error: errorSerialize(error)
    };
  }

  return {
    mismatchedPixels,
    percentage
  };
}

async function mergeImages(args) {

  const snapshotBaseDirectory = getValueOrDefault(args.baseDir, path.join(process.cwd(), 'cypress', 'snapshots', 'base'));
  const snapshotDiffDirectory = getValueOrDefault(args.diffDir, path.join(process.cwd(), 'cypress', 'snapshots', 'diff'));
  const options = {
    actualImage: path.join(CYPRESS_SCREENSHOT_DIR, args.specDirectory, `${args.fileName}-actual.png`),
    expectedImage: path.join(snapshotBaseDirectory, args.specDirectory, `${args.fileName}-base.png`),
    diffImage: path.join(snapshotDiffDirectory, args.specDirectory, `${args.fileName}-diff.png`)
  };

  try {
    await joinImages([options.expectedImage, options.diffImage, options.actualImage], {direction:'vertical', margin:20})
    .then((img) => {
      var dir = path.join(CYPRESS_SCREENSHOT_DIR, args.specName)
      if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
      }
      img.toFile(path.join(dir, `${args.fileName} (failed).png`));
    });
  } catch (error) {
    return { error };
  }
  return true;
}


/** Install plugin to compare snapshots.
 * (Also installs an internally used plugin to move snapshot files). */


function getCompareSnapshotsPlugin(on, config) {
  setupScreenshotPath(config);
  on('task', {
    compareSnapshotsPlugin,
    moveSnapshot,
    updateSnapshot,
    mergeImages
  });
}

module.exports = getCompareSnapshotsPlugin;
