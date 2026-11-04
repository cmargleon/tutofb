import { test, expect } from '@playwright/test';
// Real frontend adapters, simulated SDK; every external request is blocked.
test('client/model/review adapters use the shared backend without direct document writes', async ({ page }) => {
    const calls: any[] = [];
    await page.exposeFunction('__serviceCall', (name: string, data: any) => { calls.push({ name, data }); return { data: { id: 'saved-model' } }; });
    await page.route('https://**/*', route => route.abort());
    await page.route('**/src/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const db={};export const storage={};export const functions={};export const auth={currentUser:{uid:"isolated-admin"}};' }));
    await page.route('**/node_modules/.vite/deps/firebase_functions.js*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const httpsCallable=(_functions,name)=>data=>window.__serviceCall(name,data);' }));
    await page.route('**/manglar-services-preview*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><button id="run">Probar adaptadores</button><output id="result"></output><script type="module">
    import {createClient,updateClient,archiveClient,restoreClient} from '/src/features/clients/firebase.ts';
    import {createModelFromPaths,replaceModelPoseWithGeneratedPhoto,archiveModel,restoreModel} from '/src/features/models/firebase.ts';
    import {setJobManualFlag} from '/src/features/evaluation/firebase.ts';
    document.querySelector('#run').onclick=async()=>{try{
      await createClient('Cliente','Prompt');await updateClient('client','Cliente editado');await archiveClient('client');await restoreClient('client');
      await createModelFromPaths('client','Modelo',[{storagePath:'model_generations/client/session/photo.png',contentType:'image/png'}],{identityTraits:null,generatedPhotoCount:1,generatedPhotoCostUsd:0.1});
      await replaceModelPoseWithGeneratedPhoto({id:'model',poses:[{id:'pose'}]},'pose',{storagePath:'model_generations/client/session/new.png',contentType:'image/png',index:0},null,0.2);
      await archiveModel('model');await restoreModel('model');await setJobManualFlag('job',true,'isolated-admin');
      document.querySelector('#result').textContent='OK';
    }catch(error){document.querySelector('#result').textContent=error.message;}};
  </script></body></html>` }));
    await page.goto('/manglar-services-preview');
    await page.getByRole('button', { name: 'Probar adaptadores' }).click();
    await expect(page.locator('#result')).toHaveText('OK');
    expect(calls.map(call => call.name)).toEqual(['saveClient', 'saveClient', 'setClientArchived', 'setClientArchived', 'saveModel', 'replaceModelPose', 'setModelArchived', 'setModelArchived', 'setJobManualFlag']);
    expect(calls[4].data.posesToAdd[0].storagePath).toBe('model_generations/client/session/photo.png');
    expect(calls[5].data).toMatchObject({ modelId: 'model', poseId: 'pose', estimatedCostUsd: 0.2 });
    expect(calls[8].data).toEqual({ jobId: 'job', flagged: true });
});
