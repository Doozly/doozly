let audio: AudioContext | undefined;

/** A short rising two-note chime for completing a task. Made on the fly, so no sound file to ship. */
export function playDing() {
  try {
    audio ??= new AudioContext();
    const start = audio.currentTime;
    for (const [i, frequency] of [880, 1320].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const t = start + i * 0.08;
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    }
  } catch {
    // No Web Audio (or blocked), then it's a silent tick
  }
}
