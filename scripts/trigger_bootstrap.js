import { env } from 'node:process';

async function main() {
  const port = env.API_PORT || '4000';
  const url = `http://localhost:${port}/api/data-bootstrap/free`;

  console.log(`Triggering free data bootstrap at ${url}...`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marketFilter: 'Prime',
        maxSymbols: 30, // Default safe max symbols
      }),
    });
    if (res.ok) {
      console.log('Bootstrap job triggered successfully! Run status: ', res.status);
      console.log(await res.json());
    } else {
      console.error('Failed to trigger bootstrap job:', res.status, await res.text());
    }
  } catch (e) {
    console.error('Network error triggering bootstrap:', String(e));
  }
}

main();
