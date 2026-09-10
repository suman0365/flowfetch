import express from 'express';
import path from 'path';
import fs from 'fs';

const app = express();
const testFilePath = path.resolve(__dirname, 'test.txt');

// Create test file
fs.writeFileSync(testFilePath, 'Hello World');

app.get('/test', (req, res) => {
  console.log('Exists:', fs.existsSync(testFilePath));
  console.log('Path:', testFilePath);
  res.download(testFilePath, 'test.txt', (err) => {
    if (err) {
      console.error('Download error:', err);
      res.status(500).send('Error');
    }
  });
});

app.listen(3001, () => {
  console.log('Test server running on 3001');
});
