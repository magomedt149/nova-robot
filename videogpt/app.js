(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const form = $('#promptForm');
  const imageInput = $('#personImage');
  const videoInput = $('#referenceVideo');
  const output = $('#promptOutput');
  const status = $('#promptStatus');
  const copyButton = $('#copyPrompt');
  const downloadButton = $('#downloadPrompt');

  function clean(value, limit = 900) {
    return String(value || '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function updateFile(input, nameSelector, dropSelector, fallback) {
    const file = input.files?.[0];
    $(nameSelector).textContent = file?.name || fallback;
    $(dropSelector).classList.toggle('has-file', Boolean(file));
  }

  imageInput.addEventListener('change', () => updateFile(imageInput, '#imageName', '#imageDrop', 'Выбрать изображение'));
  videoInput.addEventListener('change', () => updateFile(videoInput, '#videoName', '#videoDrop', 'Выбрать видео'));

  function subtitleInstruction(mode) {
    if (mode === 'off') return 'Do not add subtitles, captions, labels, watermarks, logos, or extra on-screen text.';
    if (mode === 'clean') return 'Create accurate Russian subtitles from the audible speech. Use one or two short lines, centered in the lower safe area, with exact speech timing and no spelling errors.';
    return 'Reproduce the reference subtitles exactly: wording, language, timing, line breaks, font feeling, size, placement, colors, outline, animation, and safe margins. Do not invent extra text.';
  }

  function voiceInstruction(mode) {
    if (mode === 'off') return 'Do not generate narration or a new voice. Preserve only necessary natural ambience from the reference.';
    if (mode === 'reference') return 'Preserve the original speech content, timing, language, emotion, pauses, lip timing, and vocal energy from the reference. Do not imitate a public figure or copyrighted character voice.';
    const tone = mode === 'female' ? 'natural adult female cinematic voice' : 'natural adult male cinematic voice';
    return `Use a ${tone}, speaking Russian clearly with restrained emotion. Synchronize every word to the visible lips and keep the same speech windows as the reference.`;
  }

  function musicInstruction(mode) {
    if (mode === 'off') return 'Do not add background music.';
    if (mode === 'match') return 'Match the reference music mood, intensity curve, beat placement, and edit rhythm without copying a protected recording or melody.';
    return 'Use very low cinematic instrumental ambience under speech; no recognizable copyrighted melody and no abrupt volume changes.';
  }

  function buildPrompt() {
    const imageName = clean(imageInput.files?.[0]?.name, 180) || 'the uploaded person image';
    const videoName = clean(videoInput.files?.[0]?.name, 180) || 'the uploaded reference video';
    const brief = clean($('#sceneBrief').value) || 'No extra scene changes. Follow the reference only.';
    const style = clean($('#style').value, 40);
    const aspect = clean($('#aspect').value, 10);
    const duration = clean($('#duration').value, 3);
    const subtitles = subtitleInstruction($('#subtitles').value);
    const voice = voiceInstruction($('#voice').value);
    const music = musicInstruction($('#music').value);

    return `Use the person from my input image (${imageName}) as the only main person. Use my uploaded reference video (${videoName}) as the exact motion, camera, timing, environment, and editing template. Reproduce it as closely as technically possible while creating an original, authorized result.

OUTPUT — HIGHEST PRIORITY
- Vertical format: ${aspect}.
- Exact duration: ${duration} seconds.
- Visual style: ${style} and photorealistic.
- Keep all important action inside mobile safe margins.
- Deliver one continuous, fully rendered video; no split screen, collage, before/after view, or commentary.

IDENTITY CONSISTENCY
Preserve the identity and appearance of the person from the input image throughout every frame: facial proportions, eyes, nose, mouth, jaw, hairstyle, skin tone, apparent age, body proportions, and recognizable likeness. Keep one stable identity in frontal, profile, close-up, fast-motion, and low-light frames. Do not morph the face, beautify it into another person, change gender or age, duplicate the person, or introduce identity drift.

SHOT-BY-SHOT REFERENCE MATCHING
Follow the reference moment by moment. Preserve the exact shot order, action, body movement, gesture, head turn, hand and finger placement, posture, eye direction, facial expression, interaction with objects, walking or driving motion, and timing. Match the start and end pose of every shot. Do not invent actions, choreography, extra people, or extra shots.

CAMERA AND EDITING
Reproduce the reference camera position, height, distance, lens feeling, framing, crop, angle, depth of field, focus changes, close-ups, medium shots, wide shots, tracking, pan, tilt, push-in, pull-out, orbit, handheld movement, stabilization, zoom speed, and motion blur. Match every cut, transition, shot duration, pause, reaction beat, speed change, and scene change at approximately the same timestamps. Do not simplify or reorder the edit.

ENVIRONMENT, LIGHT, AND PHYSICS
Recreate the reference location, background, vehicle or room, architecture, road, furniture, props, wardrobe, weather, time of day, lighting direction, shadows, reflections, atmosphere, and background motion. Keep important objects in the same relative positions. Use believable body mechanics, foot placement, hand contact, vehicle motion, wheel rotation, road parallax, hair and fabric motion, reflections, and shadows. Avoid floating, sliding, warping, frozen wheels, broken hands, disappearing objects, or inconsistent physics.

SCENE-SPECIFIC NOTE
${brief}

AUDIO AND VOICE
${voice}
${music}
Keep speech, visible lip movement, reactions, cuts, and sound effects synchronized.

SUBTITLES
${subtitles}

NEGATIVE CONSTRAINTS
No identity change, face swap artifacts, flicker, frame-to-frame face variation, asymmetrical eyes, distorted teeth, extra fingers, fused hands, broken limbs, rubber motion, duplicated objects, geometry melting, inconsistent wardrobe, lighting jumps, random camera movement, added scenes, changed action order, unwanted text, watermark, logo, letterboxing, black bars, split screen, or horizontal framing.

FINAL QUALITY CHECK
Before finalizing, verify identity stability, ${aspect} framing, exact ${duration}-second duration, shot order, motion timing, camera path, cut timing, background continuity, subtitle timing, lip sync, hands, eyes, reflections, and object permanence against the reference. If a creative choice conflicts with the reference, follow the reference.`;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!$('#consent').checked) {
      status.textContent = 'Подтвердите право на использование материалов.';
      status.className = 'prompt-status error';
      $('#consent').focus();
      return;
    }
    output.value = buildPrompt();
    copyButton.disabled = false;
    downloadButton.disabled = false;
    status.textContent = 'Промпт собран. Проверьте длительность и скопируйте его в VideoGPT.';
    status.className = 'prompt-status success';
    output.focus();
    output.setSelectionRange(0, 0);
  });

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.value);
    } catch (_) {
      output.select();
      document.execCommand('copy');
      output.setSelectionRange(0, 0);
    }
    status.textContent = 'Промпт скопирован.';
    status.className = 'prompt-status success';
  });

  downloadButton.addEventListener('click', () => {
    const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nova-videogpt-prompt.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
