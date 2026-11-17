// Reference indices must come from the exact ordered image list sent to the provider.
export function buildH3ReferencePrompt(prompt, references) {
  if (!references.length) return prompt;
  let description = prompt;
  const definitions = [];
  const cast = [];
  for (const ref of references) {
    const picture = `<Picture ${ref.index}>`;
    const subject = `<Subject ${ref.index}>`;
    const marker = `@图片${ref.index}${ref.name}`;
    description = description.split(marker).join(`${subject} ${ref.name}`);
    if (ref.kind === 'character') {
      cast.push(ref.name);
      const lock = ref.appearanceLock ? ` Fixed appearance: ${String(ref.appearanceLock).trim().slice(0, 500)}` : '';
      const layout = ref.singleView ? 'This is a single-person reference.' : 'If this is a multi-view character sheet, every portrait, front, side and back view depicts this SAME individual, never separate people. Transfer the identity, not the sheet layout.';
      definitions.push(`${subject} is ${ref.name}, the ONE character whose identity, face and costume are shown in ${picture}. ${layout}${lock}`);
    } else if (ref.kind === 'scene') {
      definitions.push(`${subject} is the environment ${ref.name} from ${picture}. Use its architecture, furniture and lighting only; do not import incidental people from the environment reference.`);
    } else {
      definitions.push(`${subject} is the prop ${ref.name} from ${picture}, not a character.`);
    }
  }
  // Define appearance once; repeating long cast descriptions in every shot can amplify duplicate people.
  const continuity = 'All cuts belong to the same continuous scene. Keep the same face shape, age, hair color and hairstyle, glasses, garment cut, garment colors and accessories in every shot and reverse angle. The reference images and fixed appearance definitions are the visual source of truth, not stereotypes associated with family roles. Do not swap costumes or faces between subjects. Lighting may change shading, never the underlying garment color. Change appearance only when the original story explicitly depicts that change.';
  return `subject_definitions:\n${definitions.join('\n')}\n\nsummary:\n[reference generation] Follow the original shot plan below. ${cast.length ? `The reference cast contains ${cast.length} distinct identities: ${cast.join(', ')}. Each identity has only ONE physical instance in the scene. A reverse angle or cut shows the same person, not a new copy. Do not add unrequested people, lookalikes or duplicate characters. Show only the people called for by each shot, not the whole cast in every close-up.` : ''}\n\nretention_analysis:\n${continuity}\nReference-sheet panels are alternative views of one person. Do not reproduce collages, split screens, portrait inserts or turnaround-sheet arrangements. Keep the scene's spatial continuity.\n\ndetailed_description:\n${description}`;
}
