
// Run feature detection.
let supportsFileSystemAccessAPI = false,
    supportsWebkitGetAsEntry = false;
try {
  supportsFileSystemAccessAPI = 'getAsFileSystemHandle' in DataTransferItem.prototype;
  supportsWebkitGetAsEntry = 'webkitGetAsEntry' in DataTransferItem.prototype;
} catch (e) {}

async function extractFilesFromDataItems(dataItems) {
  const files = [];

  // Collect entries immediately
  const items = dataItems
    .filter(item => item.kind === 'file')
    .map(item => {
      if (supportsFileSystemAccessAPI && typeof item.getAsFileSystemHandle === 'function') {
        return {
          'type'  : 'FileSystemHandle',
          'entry' : item.getAsFileSystemHandle() // Promise
        };
      }
      if (supportsWebkitGetAsEntry && typeof item.webkitGetAsEntry === 'function') {
        return {
          'type'  : 'WebkitEntry',
          'entry' : item.webkitGetAsEntry()
        };
      }
      return {
        'type'  : 'Naive',
        'entry' : item
      };
    });

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if(!item || !item.entry) { continue; }

    switch (item.type) {
      case 'FileSystemHandle':
      {
        const handleEntry = async (e) => {
          if( e.kind === 'file' ) {
            const file = await e.getFile();
            files.push( file );
            return;
          } else if (e.kind === 'directory') {
            for await (const [name, child] of e.entries()) {
              await handleEntry(child);
            }
          }
        };
        const entry = await item.entry;
        console.debug(`Using FileSystemAccessAPI to open [${ entry.name }]`);
        await handleEntry( entry );
        break;
      }

      case 'WebkitEntry':
      {
        console.debug(`Using WebkitGetAsEntry to open [${ item.entry.name }]`);
        const subFiles = await getFilesFromWebkitEntry( item.entry );
        files.push(...subFiles);
        break;
      }

      default:
      {
        const file = item.entry.getAsFile();
        console.debug(`Using Naive method to open the file ${ file.name }`);
        if( file ) {
          files.push( file );
        }
      }
    }
  }

  return files;
}

async function getFilesFromWebkitEntry(entry) {
  const files = [];
  const callback = (file) => {
    if(file) { files.push(file); }
  };
  const onError = (e) => { console.error(e) };

  const handleEntry = async (e) => {
    if (e.isFile) {
      const p = new Promise((resolve, reject) => {
        e.file((file) => {
          if( file ) {
            files.push(file);
          }
          resolve();
        }, resolve);
      });
      await p;
    } else if (e.isDirectory) {
      const reader = e.createReader();
      const p = new Promise((resolve, reject) => {
        reader.readEntries(async (entries) => {
          for (const e of entries) {
            await handleEntry(e);
          }
          resolve();
        }, resolve);
      });
      await p;
    }
  }

  await handleEntry(entry);
  return files;
}

async function getFilesFromFileSystemAccessAPIEntry(entry) {
  const files = [];

  const handleEntry = async (e) => {
    if( e.kind === 'file' ) {
      const file = await e.getFile();
      files.push( file );
      return;
    } else if (e.kind === 'directory') {
      for await (const [name, child] of e.entries()) {
        await handleEntry(child);
      }
    }
  };

  await handleEntry( entry );
  return files;
}

function getFilesNaiveFiles(entry) {
  if(entry.kind === 'file') {
    return [entry.getAsFile()];
  }
  return [entry];
}

async function handleDataItem(item) {

  if(item.kind === 'file') {
    if( supportsFileSystemAccessAPI ) {
      if( typeof item.getAsFileSystemHandle === 'function' ) {
        const entry = await item.getAsFileSystemHandle();
        if( entry ) {
          console.debug("Using `getAsFileSystemHandle` to handle the files.");
          return await getFilesFromFileSystemAccessAPIEntry(entry);
        }
      }
    }

    if( supportsWebkitGetAsEntry ) {
      if( typeof item.webkitGetAsEntry === 'function' ) {
        const entry = item.webkitGetAsEntry();
        if( entry ) {
          console.debug("Using `webkitGetAsEntry` to handle the files.");
          return await getFilesFromWebkitEntry(entry);
        }
      }
    }
  }

  console.debug("Using naive methods to handle the files.");
  return getFilesNaiveFiles( item );
}

async function extractFilesFromDropEvent(event) {
  // event.preventDefault();
  // resetStyle();
  if( event.dataTransfer.items ) {
    const dataItems = [...event.dataTransfer.items];
    return extractFilesFromDataItems(dataItems);
  } else {
    const files = [];
    const dataFiles = event.dataTransfer.files;
    for(let i = 0; i < dataFiles.length; i++) {
      const file = dataFiles[i];
      if( !file || !file.name ) { continue; }
      if (file.name.match(/\.(json|csv|tsv|txt)$/i)) {
        files.push(file);
      } else {
        files.unshift(file);
      }
    }
    return files;
  }
}

export { extractFilesFromDropEvent, extractFilesFromDataItems };
