// Match complete asset names, including spaces, before converting shorter names.
// The backend compiles native H3 sections using the actual ordered references.
export function resolveNamedReferenceMarkers(prompt, nameToIndex) {
  const names = Object.keys(nameToIndex).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return prompt;
  const escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return prompt.replace(new RegExp(`@(${names.map(escape).join('|')})`, 'g'), (_, name) => `@图片${nameToIndex[name]}${name}`);
}

export function buildH3ReferencePrompt(prompt, references) {
  let result = prompt;
  for (const ref of [...references].sort((a,b) => b.name.length - a.name.length)) {
    result = result.split(`@图片${ref.index}${ref.name}`).join(`<Subject ${ref.index}> ${ref.name}`);
  }
  return result;
}
