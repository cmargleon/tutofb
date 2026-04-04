import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_POSE_RECIPES } from '../src/features/models/constants';
import {
  buildPosePromptFromRecipe,
  buildReferencePosePromptFromRecipe,
} from '../src/features/models/prompts';

test('las poses de cuerpo completo agregan reglas de head-to-feet y lectura comercial', () => {
  const fullFrontRecipe = MODEL_POSE_RECIPES.find((recipe) => recipe.id === 'full-front');

  assert.ok(fullFrontRecipe);

  const prompt = buildPosePromptFromRecipe('Base prompt.', fullFrontRecipe);

  assert.match(prompt, /full body from head to full feet/i);
  assert.match(prompt, /both feet fully visible/i);
  assert.match(prompt, /true front view/i);
  assert.match(prompt, /clean catalog readability/i);
});

test('las poses de tren inferior fuerzan prenda completa y rostro fuera de cuadro en prompts', () => {
  const lowerFrontRecipe = MODEL_POSE_RECIPES.find((recipe) => recipe.id === 'lower-front');

  assert.ok(lowerFrontRecipe);

  const directPrompt = buildPosePromptFromRecipe('Base prompt.', lowerFrontRecipe);
  const referencePrompt = buildReferencePosePromptFromRecipe('Base prompt.', lowerFrontRecipe);

  for (const prompt of [directPrompt, referencePrompt]) {
    assert.match(prompt, /strictly from the waist to the full feet/i);
    assert.match(prompt, /both feet completely inside the frame/i);
    assert.match(prompt, /do not crop above the waist/i);
    assert.match(prompt, /do not crop any part of the feet/i);
    assert.match(prompt, /full lower garment must be fully visible/i);
    assert.match(prompt, /do not show the model face or head/i);
  }
});

test('las poses de retrato fuerzan primer plano facial y evitan abrir a medio cuerpo', () => {
  const portraitRecipe = MODEL_POSE_RECIPES.find((recipe) => recipe.id === 'portrait-front');

  assert.ok(portraitRecipe);

  const prompt = buildReferencePosePromptFromRecipe('Base prompt.', portraitRecipe);

  assert.match(prompt, /tight portrait/i);
  assert.match(prompt, /face as the primary subject/i);
  assert.match(prompt, /do not widen the frame into a half-body or full-body composition/i);
  assert.match(prompt, /face looking clearly toward the camera/i);
});

test('las poses con modificadores añaden instrucciones específicas de composición', () => {
  const walkingRecipe = MODEL_POSE_RECIPES.find((recipe) => recipe.id === 'full-walking');
  const contrappostoRecipe = MODEL_POSE_RECIPES.find((recipe) => recipe.id === 'full-contrapposto');

  assert.ok(walkingRecipe);
  assert.ok(contrappostoRecipe);

  const walkingPrompt = buildPosePromptFromRecipe('Base prompt.', walkingRecipe);
  const contrappostoPrompt = buildPosePromptFromRecipe('Base prompt.', contrappostoRecipe);

  assert.match(walkingPrompt, /subtle walking action/i);
  assert.match(walkingPrompt, /do not introduce motion blur/i);
  assert.match(contrappostoPrompt, /weight naturally onto one leg/i);
  assert.match(contrappostoPrompt, /waist, hips, and garment silhouette readable/i);
});
