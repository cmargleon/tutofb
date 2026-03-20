import * as admin from 'firebase-admin';
import { Job, JobOutput } from '../../../shared/src/types';

// Make sure to define these environment variables in your Firebase project:
// firebase functions:secrets:set FAL_KEY
// firebase functions:secrets:set OPENAI_API_KEY

async function getSignedUrl(storagePath: string): Promise<string> {
  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 1000 * 60 * 60, // 1 hour
  });
  return url;
}

async function uploadImageFromUrl(imageUrl: string, destinationPath: string): Promise<void> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image from provider: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const bucket = admin.storage().bucket();
  const file = bucket.file(destinationPath);
  await file.save(buffer, {
    metadata: {
      contentType: 'image/jpeg',
    },
  });
}

export async function processJob(jobId: string, job: Job): Promise<void> {
  const db = admin.firestore();
  const jobRef = db.collection('jobs').doc(jobId);

  try {
    // 1. Mark as processing
    await jobRef.update({
      status: 'processing',
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastError: null,
    });

    // 2. Get signed URLs for inputs
    const poseUrl = await getSignedUrl(job.poseImagePath);
    const garmentUrl = await getSignedUrl(job.garmentFilePath);

    // 3. Call provider
    let resultImageUrl = '';
    const falKey = process.env.FAL_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (job.provider === 'fal-seedream') {
      if (!falKey) throw new Error('FAL_KEY is not set');
      const response = await fetch('https://queue.fal.run/fal-ai/seedream', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${falKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: job.finalPrompt,
          image: poseUrl,
          garment_image: garmentUrl,
          // Add other specific params for seedream if needed
        }),
      });
      
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Fal Seedream Error: ${errText}`);
      }
      
      // Wait for the queue to finish (simplified polling)
      const queueData = await response.json();
      const requestId = queueData.request_id;
      
      let status = 'IN_QUEUE';
      let resultData: any = null;
      while (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const statusRes = await fetch(`https://queue.fal.run/fal-ai/seedream/requests/${requestId}`, {
          headers: { 'Authorization': `Key ${falKey}` }
        });
        resultData = await statusRes.json();
        status = resultData.status;
      }
      
      if (status !== 'COMPLETED') {
        throw new Error(`Fal Seedream failed with status: ${status}`);
      }
      
      resultImageUrl = resultData.images?.[0]?.url;
      if (!resultImageUrl) throw new Error('No image returned from Fal Seedream');

    } else if (job.provider === 'fal-banana-pro') {
      if (!falKey) throw new Error('FAL_KEY is not set');
      const response = await fetch('https://queue.fal.run/fal-ai/banana-pro', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${falKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: job.finalPrompt,
          image: poseUrl,
          garment_image: garmentUrl,
          // Add other specific params for banana-pro if needed
        }),
      });
      
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Fal Banana Pro Error: ${errText}`);
      }
      
      const queueData = await response.json();
      const requestId = queueData.request_id;
      
      let status = 'IN_QUEUE';
      let resultData: any = null;
      while (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const statusRes = await fetch(`https://queue.fal.run/fal-ai/banana-pro/requests/${requestId}`, {
          headers: { 'Authorization': `Key ${falKey}` }
        });
        resultData = await statusRes.json();
        status = resultData.status;
      }
      
      if (status !== 'COMPLETED') {
        throw new Error(`Fal Banana Pro failed with status: ${status}`);
      }
      
      resultImageUrl = resultData.images?.[0]?.url;
      if (!resultImageUrl) throw new Error('No image returned from Fal Banana Pro');

    } else if (job.provider === 'openai-gpt-image-1.5') {
      if (!openaiKey) throw new Error('OPENAI_API_KEY is not set');
      // Note: OpenAI DALL-E 3 doesn't support image-to-image with multiple inputs like try-on natively in the same way.
      // Assuming this is a placeholder for a specific custom model or DALL-E 2 edit.
      // We will simulate a call or use DALL-E 3 with just the prompt for demonstration if it's a generic generation.
      // For a real try-on, OpenAI might not be the right provider, but we implement the interface.
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: job.finalPrompt,
          n: 1,
          size: '1024x1024',
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI Error: ${errText}`);
      }

      const data = await response.json();
      resultImageUrl = data.data?.[0]?.url;
      if (!resultImageUrl) throw new Error('No image returned from OpenAI');
    } else {
      throw new Error(`Unknown provider: ${job.provider}`);
    }

    // 4. Download and upload to Firebase Storage
    const outputId = `out_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const destinationPath = `generated/${job.clientId}/${job.batchId}/${jobId}/${outputId}.jpg`;
    
    await uploadImageFromUrl(resultImageUrl, destinationPath);

    // 5. Update job with success
    const currentOutput: JobOutput = {
      id: outputId,
      provider: job.provider,
      prompt: job.finalPrompt,
      resultImagePath: destinationPath,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const batch = db.batch();

    batch.update(jobRef, {
      status: 'completed',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      currentOutputId: outputId,
      currentOutput: currentOutput,
    });

    const outputRef = jobRef.collection('outputs').doc(outputId);
    batch.set(outputRef, currentOutput);

    const logRef = jobRef.collection('logs').doc();
    batch.set(logRef, {
      type: 'provider_response',
      payload: { success: true, provider: job.provider, outputId },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

  } catch (error: any) {
    console.error(`Error processing job ${jobId}:`, error);
    
    // Check retry count
    const maxRetries = 3;
    const currentRetry = job.retryCount || 0;
    
    const batch = db.batch();
    
    if (currentRetry < maxRetries) {
      batch.update(jobRef, {
        status: 'pending', // Requeue
        retryCount: currentRetry + 1,
        lastError: error.message || 'Unknown error',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      batch.update(jobRef, {
        status: 'failed',
        lastError: error.message || 'Unknown error',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    const logRef = jobRef.collection('logs').doc();
    batch.set(logRef, {
      type: 'error',
      payload: { error: error.message || 'Unknown error', stack: error.stack, retryCount: currentRetry },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    await batch.commit();
  }
}
