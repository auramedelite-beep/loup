export type SoundName =
  | 'click'
  | 'hover'
  | 'success'
  | 'error'
  | 'reveal'
  | 'night'
  | 'dawn'
  | 'day'
  | 'vote'
  | 'death'
  | 'win'
  | 'lose'
  | 'message'
  | 'join'
  | 'tick'
  | 'howl';

type Ctx = AudioContext & { createGain: () => GainNode };

/** Synthesised sound effects and licensed background ambience. */
class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicAudio: HTMLAudioElement | null = null;

  soundVolume = 0.6;
  musicVolume = 0.35;
  enabled = true;
  musicEnabled = true;
  musicAllowed = true;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  configure(options: { sound?: number; music?: number; enabled?: boolean; musicEnabled?: boolean }): void {
    if (typeof options.sound === 'number') this.soundVolume = Math.min(1, Math.max(0, options.sound));
    if (typeof options.music === 'number') this.musicVolume = Math.min(1, Math.max(0, options.music));
    if (typeof options.enabled === 'boolean') {
      this.enabled = options.enabled;
      if (!this.enabled) this.stopMusic();
    }
    if (typeof options.musicEnabled === 'boolean') {
      this.musicEnabled = options.musicEnabled;
      if (!this.musicEnabled) this.stopMusic();
    }
    if (this.musicAudio) this.musicAudio.volume = Math.min(1, this.musicVolume * 2);
  }

  init(): void {
    this.ensure();
  }

  setMusicAllowed(allowed: boolean): void {
    this.musicAllowed = allowed;
    if (!allowed) this.stopMusic();
  }

  play(name: SoundName): void {
    if (!this.enabled || this.soundVolume <= 0) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    try {
      switch (name) {
        case 'click':
          this.tone(ctx, now, 430, 0.05, { type: 'triangle', gain: 0.16 });
          break;
        case 'hover':
          this.tone(ctx, now, 300, 0.04, { type: 'sine', gain: 0.05 });
          break;
        case 'success':
          [523.25, 659.25, 783.99].forEach((f, i) => this.tone(ctx, now + i * 0.07, f, 0.22, { gain: 0.14 }));
          break;
        case 'error':
          this.tone(ctx, now, 190, 0.18, { type: 'sawtooth', gain: 0.1, endFrequency: 110 });
          break;
        case 'reveal':
          this.tone(ctx, now, 196, 0.9, { type: 'sine', gain: 0.12, endFrequency: 784 });
          this.tone(ctx, now + 0.1, 392, 0.8, { type: 'triangle', gain: 0.06, endFrequency: 1175 });
          break;
        case 'night':
          this.tone(ctx, now, 138.6, 1.6, { type: 'sine', gain: 0.14, endFrequency: 55 });
          this.tone(ctx, now + 0.25, 207.7, 1.4, { type: 'triangle', gain: 0.06, endFrequency: 82.4 });
          break;
        case 'dawn':
          [261.6, 329.6, 392].forEach((f, i) => this.tone(ctx, now + i * 0.16, f, 0.5, { type: 'sine', gain: 0.1 }));
          break;
        case 'day':
          [392, 523.25].forEach((f, i) => this.tone(ctx, now + i * 0.1, f, 0.35, { gain: 0.1 }));
          break;
        case 'vote':
          this.tone(ctx, now, 740, 0.06, { gain: 0.1 });
          this.tone(ctx, now + 0.09, 587, 0.08, { gain: 0.1 });
          break;
        case 'death':
          this.tone(ctx, now, 220, 0.9, { type: 'sawtooth', gain: 0.09, endFrequency: 55 });
          this.tone(ctx, now + 0.1, 174, 0.8, { type: 'triangle', gain: 0.07, endFrequency: 43 });
          break;
        case 'win':
          [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
            this.tone(ctx, now + i * 0.11, f, 0.5, { type: 'triangle', gain: 0.12 }),
          );
          break;
        case 'lose':
          [392, 349.2, 293.7, 220].forEach((f, i) =>
            this.tone(ctx, now + i * 0.14, f, 0.55, { type: 'sine', gain: 0.1 }),
          );
          break;
        case 'message':
          this.tone(ctx, now, 880, 0.05, { gain: 0.06 });
          break;
        case 'join':
          [392, 523.25].forEach((f, i) => this.tone(ctx, now + i * 0.08, f, 0.2, { gain: 0.09 }));
          break;
        case 'tick':
          this.tone(ctx, now, 1046, 0.03, { type: 'square', gain: 0.045 });
          break;
        case 'howl':
          this.tone(ctx, now, 300, 1.8, { type: 'sine', gain: 0.1, endFrequency: 130 });
          this.tone(ctx, now + 0.3, 450, 1.4, { type: 'sine', gain: 0.045, endFrequency: 196 });
          break;
      }
    } catch {
      /* Audio is decorative — never crash the app. */
    }
  }

  private tone(
    ctx: AudioContext,
    start: number,
    frequency: number,
    duration: number,
    options: {
      type?: OscillatorType;
      gain?: number;
      endFrequency?: number;
      attack?: number;
    } = {},
  ): void {
    if (!this.master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const peak = Math.max(0.001, (options.gain ?? 0.1) * this.soundVolume);
    osc.type = options.type ?? 'sine';
    osc.frequency.setValueAtTime(frequency, start);
    if (options.endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency), start + duration);
    }
    const attack = options.attack ?? 0.008;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        /* ignore */
      }
    };
  }

  /** Play the licensed horror ambience after an explicit user gesture. */
  startMusic(): void {
    if (!this.enabled || !this.musicEnabled || !this.musicAllowed || this.musicVolume <= 0) return;
    this.musicAudio ??= new Audio(`${import.meta.env.BASE_URL}audio/mixkit-horror-ambience-2482.wav`);
    this.musicAudio.loop = true;
    this.musicAudio.preload = 'auto';
    this.musicAudio.volume = Math.min(1, this.musicVolume * 2);
    this.musicAudio.onended = () => {
      if (!this.enabled || !this.musicEnabled || !this.musicAllowed) return;
      this.musicAudio!.currentTime = 0;
      void this.musicAudio!.play().catch((error: unknown) => {
        console.error('[audio] Unable to resume background music', error);
      });
    };
    void this.musicAudio.play().catch((error: unknown) => {
      console.error('[audio] Unable to play background music', error);
    });
  }

  stopMusic(): void {
    this.musicAudio?.pause();
    if (this.musicAudio) this.musicAudio.currentTime = 0;
  }

  suspend(): void {
    this.stopMusic();
    void this.ctx?.suspend().catch(() => {});
  }
}

export const audio = new AudioManager();
