import http from 'http';

async function test() {
  console.log('Step 1: Analyzing URL...');
  const analyzeRes = await fetch('http://localhost:3000/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' })
  });
  const analyzeData = await analyzeRes.json();
  if (!analyzeData.success) throw new Error('Analyze failed: ' + analyzeData.error);
  
  const formats = analyzeData.data.formats;
  // pick the smallest video+audio format for a quick test
  const videoAudioFmt = formats.filter(f => f.type === 'video+audio').pop();
  console.log('Found format:', videoAudioFmt?.resolution, videoAudioFmt?.ext, 'filesize:', videoAudioFmt?.filesize);

  console.log('\nStep 2: Registering download job...');
  const dlRes = await fetch('http://localhost:3000/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysisId: analyzeData.data.analysisId, formatId: videoAudioFmt.id })
  });
  const dlData = await dlRes.json();
  console.log('Job created:', dlData.jobId, 'streamMode:', dlData.streamMode);
  if (dlData.streamMode !== 'process_and_stream') {
    console.error('WRONG streamMode! Expected process_and_stream, got:', dlData.streamMode);
    process.exit(1);
  }

  console.log('\nStep 3: Making GET request — measuring time until first headers arrive...');
  const startTime = Date.now();
  
  await new Promise((resolve, reject) => {
    const req = http.get('http://localhost:3000/api/download/' + dlData.jobId, (res) => {
      const headersTime = Date.now() - startTime;
      console.log('\n=== HEADERS RECEIVED ===');
      console.log('Time to first headers: ' + headersTime + 'ms');
      console.log('Status:', res.statusCode);
      console.log('content-type:', res.headers['content-type']);
      console.log('content-disposition:', res.headers['content-disposition']);
      console.log('content-length:', res.headers['content-length'] || 'MISSING');
      console.log('transfer-encoding:', res.headers['transfer-encoding'] || 'none');
      console.log('accept-ranges:', res.headers['accept-ranges'] || 'none');

      if (!res.headers['content-disposition']) {
        console.error('FAIL: content-disposition missing!');
      }
      if (!res.headers['content-length']) {
        console.warn('WARN: content-length missing — Chrome will show no total size');
      } else {
        console.log('PASS: content-length is set, Chrome will show X/Y MB');
      }

      let bytesReceived = 0;
      res.on('data', (chunk) => {
        bytesReceived += chunk.length;
        if (bytesReceived > 100000) {
          console.log('\nFirst ' + bytesReceived + ' bytes received after ' + (Date.now() - startTime) + 'ms — test passed, aborting connection.');
          req.destroy();
          resolve(null);
        }
      });
      res.on('end', () => resolve(null));
      res.on('error', (e) => {
        if (e.code === 'ECONNRESET' || e.message.includes('socket hang up')) {
          resolve(null);
        } else {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    setTimeout(() => {
      req.destroy();
      reject(new Error('Timed out 20s — backend never sent headers!'));
    }, 20000);
  });
  
  console.log('\nVerification complete.');
}

test().catch(e => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
