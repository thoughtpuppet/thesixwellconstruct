export function createEntryAudio() {
  const sound = new Audio('/assets/audio/console-startup.wav');
  sound.preload = 'auto';
  sound.volume = 0.34;

  return {
    play() {
      sound.currentTime = 0;
      return sound.play().catch(() => {});
    }
  };
}
