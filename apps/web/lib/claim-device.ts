export function isPhoneOrTablet(agent: string, platform: string, touchPoints: number) {
  return /iPhone|iPad|iPod|Android/iu.test(agent) || (platform === 'MacIntel' && touchPoints > 1)
}
