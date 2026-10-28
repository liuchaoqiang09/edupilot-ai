"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechInputSupported() {
  return Boolean(speechCtor());
}

/**
 * 桌面 / 平板 / 手机共用：点击切换听写，转写写入 draft，不自动发送。
 * 依赖浏览器 Web Speech（Chrome/Edge/新版 Safari 较好；不支持则 supported=false）。
 */
export function useXiaoxingSpeech(opts: {
  enabled: boolean;
  onTranscript: (text: string, isFinal: boolean) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListenRef = useRef(false);
  const onTranscriptRef = useRef(opts.onTranscript);
  onTranscriptRef.current = opts.onTranscript;

  useEffect(() => {
    setSupported(speechInputSupported());
  }, []);

  const stop = useCallback(() => {
    wantListenRef.current = false;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    try {
      rec?.stop();
    } catch {
      /* ignore */
    }
    try {
      rec?.abort();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  useEffect(() => {
    if (!opts.enabled) stop();
  }, [opts.enabled, stop]);

  useEffect(() => () => stop(), [stop]);

  const start = useCallback(() => {
    const Ctor = speechCtor();
    if (!Ctor) {
      setSupported(false);
      setError("当前浏览器不支持语音输入，请改用键盘。");
      return;
    }
    stop();
    const rec = new Ctor();
    recognitionRef.current = rec;
    wantListenRef.current = true;
    // 触控端（手机/平板）continuous 不稳定，一句结束即停，再点可继续；桌面可连续听写。
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    rec.lang = "zh-CN";
    rec.continuous = !coarse;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let finalChunk = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const row = event.results[i];
        const piece = row?.[0]?.transcript?.trim() ?? "";
        if (!piece) continue;
        if (row.isFinal) finalChunk += `${piece}`;
        else interim += piece;
      }
      if (finalChunk) onTranscriptRef.current(finalChunk, true);
      else if (interim) onTranscriptRef.current(interim, false);
    };

    rec.onerror = (event) => {
      const code = event.error ?? "";
      if (code === "aborted" || code === "no-speech") {
        setListening(false);
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        setError("未获得麦克风权限。请在系统或浏览器设置中允许本站使用麦克风后重试。");
      } else if (code === "network") {
        setError("语音服务暂时不可用，请检查网络后重试，或改用键盘输入。");
      } else {
        setError("语音识别中断，请再点一次麦克风，或改用键盘。");
      }
      wantListenRef.current = false;
      setListening(false);
    };

    rec.onend = () => {
      // 仅桌面 continuous 时在静音打断后自动续听；触控端停住等用户再点（更稳）。
      if (wantListenRef.current && recognitionRef.current === rec && !coarse) {
        try {
          rec.start();
          setListening(true);
          return;
        } catch {
          wantListenRef.current = false;
        }
      }
      wantListenRef.current = false;
      setListening(false);
    };

    try {
      setError("");
      rec.start();
      setListening(true);
    } catch {
      setError("无法启动语音输入。请确认使用 HTTPS 或本机环境，并允许麦克风。");
      wantListenRef.current = false;
      setListening(false);
    }
  }, [stop]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, error, setError, toggle, stop };
}
