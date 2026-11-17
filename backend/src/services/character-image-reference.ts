export function characterReferences(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const refs: unknown = JSON.parse(value)
    return Array.isArray(refs) ? refs.filter((v): v is string => typeof v === 'string' && !!v.trim()) : []
  } catch { return [] }
}

export function withCharacterReference(prompt: string, refs: string[]): string {
  if (!refs.length) return prompt
  return `${prompt}\n\n人物参考要求：参考所附照片中人物的脸型、五官比例及有辨识度的外貌特征，结合上述原始角色设定生成同一人物的角色资产。角色的年龄、服装、发型、表情、姿态、构图与画面风格以上述角色设定为准；将人物自然转化为指定美术风格。不要复制参考照片的背景、无关人物、文字或水印。`
}
