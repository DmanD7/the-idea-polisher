
import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { polishNotes, generateExpansions, extractCategory, transcribeAudio } from './services/geminiService';
import { Button } from './components/Button';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { EmailModal } from './components/EmailModal';
import { AppStatus } from './types';

const WEB3FORMS_ACCESS_KEY: string = "699a4446-e030-4b96-b4d8-225a571478ba"; 
const GOOGLE_SHEET_WEBAPP_URL: string = "https://script.google.com/macros/s/AKfycbybDBPnWki60slPxe9IT_C7f-GqcL5xzvm6Sjqy9uggOWt_lMo49ZKAoh5ehdIjDmts/exec"; 
const SUPABASE_URL: string = "https://ejveqhjtbuphmlrrjyev.supabase.co"; 
const SUPABASE_ANON_KEY: string = "sb_publishable_DVQAvIkmWrsk0JQNf56fPw_xzj4waCe"; 

const STORAGE_KEY = 'polisher_default_email';

const App: React.FC = () => {
  const [rawNotes, setRawNotes] = useState('');
  const [polishedContent, setPolishedContent] = useState('');
  const [expansionContent, setExpansionContent] = useState('');
  const [category, setCategory] = useState('General');
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  
  const [defaultEmail, setDefaultEmail] = useState<string | null>(null);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isSettingNewDefault, setIsSettingNewDefault] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState(false);
  
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveSuccess, setArchiveSuccess] = useState(false);

  // Voice Recording & Cancellation State
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeRequestIdRef = useRef<number>(0);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setDefaultEmail(saved);
  }, []);

  const stopActiveRecorder = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    setIsRecording(false);
  };

  const cancelAllProcessing = () => {
    activeRequestIdRef.current += 1; // Incrementing effectively ignores older pending promises
    stopActiveRecorder();
    setIsTranscribing(false);
    if (status === AppStatus.POLISHING) setStatus(AppStatus.IDLE);
    setError(null);
  };

  const handleStartRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Determine what the browser actually supports
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : 'audio/mp4';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      const requestId = activeRequestIdRef.current;

      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length === 0) {
          setIsTranscribing(false);
          return;
        }
        
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        setIsTranscribing(true);
        
        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            if (activeRequestIdRef.current !== requestId) return;

            const base64Audio = (reader.result as string).split(',')[1];
            try {
              const transcript = await transcribeAudio(base64Audio, mimeType);
              
              if (activeRequestIdRef.current === requestId) {
                if (transcript) {
                  setRawNotes(prev => (prev ? prev.trim() + " " + transcript : transcript));
                } else {
                  setError("No voice detected. Please try speaking closer to the microphone.");
                }
                setIsTranscribing(false);
              }
            } catch (err: any) {
              if (activeRequestIdRef.current === requestId) {
                console.error("Transcription error:", err);
                setIsTranscribing(false);
                setError(err.message || "Failed to process audio. Please try again.");
              }
            }
          };
        } catch (err) {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Mic access error:", err);
      setError("Microphone access denied. Please check your browser permissions.");
    }
  };

  const handleStopRecording = () => {
    stopActiveRecorder();
  };

  const handlePolish = async () => {
    if (!rawNotes.trim()) return;
    const requestId = ++activeRequestIdRef.current;
    setStatus(AppStatus.POLISHING);
    setError(null);
    setEmailSuccess(false);
    setArchiveSuccess(false);

    try {
      const result = await polishNotes(rawNotes);
      if (activeRequestIdRef.current !== requestId) return;

      const [expansions, cat] = await Promise.all([
        generateExpansions(result),
        extractCategory(result)
      ]);
      
      if (activeRequestIdRef.current !== requestId) return;

      setPolishedContent(result);
      setExpansionContent(expansions);
      setCategory(cat);
      setStatus(AppStatus.SUCCESS);

      setTimeout(() => {
        const resultSection = document.getElementById('result-section');
        resultSection?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (err: any) {
      if (activeRequestIdRef.current === requestId) {
        setError(err.message || 'An unexpected error occurred.');
        setStatus(AppStatus.ERROR);
      }
    }
  };

  const handleArchive = async () => {
    setIsArchiving(true);
    const lines = polishedContent.split('\n');
    const titleLine = lines.find(l => l.startsWith('# ')) || 'Untitled Project';
    const cleanTitle = titleLine.replace('# ', '').trim();
    const archiveId = `POL-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const payload = {
      title: cleanTitle,
      original_notes: rawNotes,
      polished_outline: polishedContent,
      expansion_ideas: expansionContent,
      recipient_email: defaultEmail || "Not Emailed",
      category: category,
      archive_id: archiveId
    };

    try {
      const tasks: Promise<any>[] = [];
      if (GOOGLE_SHEET_WEBAPP_URL) {
        tasks.push(fetch(GOOGLE_SHEET_WEBAPP_URL, {
          method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }));
      }
      if (SUPABASE_URL) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        tasks.push((async () => {
          const { error } = await supabase.from('polished_ideas').insert([payload]);
          if (error) throw error;
        })());
      }
      await Promise.all(tasks);
      setArchiveSuccess(true);
      setTimeout(() => setArchiveSuccess(false), 3000);
    } catch (err) {
      setError("Archiving failed. Please verify your cloud settings.");
    } finally {
      setIsArchiving(false);
    }
  };

  const handleReset = () => {
    cancelAllProcessing();
    setRawNotes('');
    setPolishedContent('');
    setExpansionContent('');
    setCategory('General');
    setStatus(AppStatus.IDLE);
    setError(null);
    setEmailSuccess(false);
    setArchiveSuccess(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const isAnyProcessing = status === AppStatus.POLISHING || isTranscribing;

  return (
    <div className="min-h-screen pb-20 selection:bg-[#d8f3dc]">
      <EmailModal 
        isOpen={isEmailModalOpen}
        onClose={() => { setIsEmailModalOpen(false); setIsSettingNewDefault(false); }}
        defaultEmail={isSettingNewDefault ? null : defaultEmail}
        onConfirm={async (email, save) => {
          setIsSendingEmail(true);
          if (save) { localStorage.setItem(STORAGE_KEY, email); setDefaultEmail(email); }
          try {
            const lines = polishedContent.split('\n');
            const titleLine = lines.find(l => l.startsWith('# ')) || 'Polished Project Outline';
            const cleanTitle = titleLine.replace('# ', '').trim();
            const response = await fetch("https://api.web3forms.com/submit", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                access_key: WEB3FORMS_ACCESS_KEY,
                subject: `✨ Polished Idea: ${cleanTitle}`,
                from_name: "Idea Polisher AI",
                message: `Your project is ready!\n\n${polishedContent}\n\n---\n🚀 EXPANSION\n${expansionContent}`,
              }),
            });
            const res = await response.json();
            if (res.success) {
              setEmailSuccess(true);
              setTimeout(() => { setIsEmailModalOpen(false); setEmailSuccess(false); }, 2500);
            }
          } catch (e) { alert("Email failed."); }
          finally { setIsSendingEmail(false); setIsSettingNewDefault(false); }
        }}
        isSending={isSendingEmail}
        isSuccess={emailSuccess}
      />

      <header className="bg-white/80 border-b border-slate-200 sticky top-0 z-50 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={handleReset}>
            <div className="w-8 h-8 bg-[#1b4332] rounded-lg flex items-center justify-center text-white shadow-md">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">The Idea Polisher</h1>
          </div>
          <div className="flex items-center gap-3">
            {isAnyProcessing && (
              <button 
                onClick={cancelAllProcessing}
                className="text-xs font-bold text-rose-500 bg-rose-50 px-3 py-1.5 rounded-full hover:bg-rose-100 transition-colors"
              >
                STOP
              </button>
            )}
            <Button variant="outline" onClick={handleReset} className="py-1.5 px-4 text-xs font-medium">Start New</Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 mt-12">
        {status !== AppStatus.SUCCESS && (
          <div className="text-center mb-12 animate-in fade-in duration-700">
            <h2 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4 tracking-tight leading-tight">
              From <span className="text-[#1b4332]">Messy Thoughts</span> to <br/> <span className="text-[#52b788] underline decoration-[#b7e4c7] underline-offset-8">Perfect Outlines</span>.
            </h2>
          </div>
        )}

        {status !== AppStatus.SUCCESS && (
          <section className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden relative">
            <div className="p-6 md:p-10">
              <textarea
                className="w-full h-64 md:h-80 p-8 bg-[#fbfaf5]/50 rounded-2xl border-2 border-slate-100 focus:border-[#52b788] focus:bg-white outline-none transition-all text-slate-700 text-lg"
                placeholder="Click the mic to speak or paste your notes here..."
                value={rawNotes}
                onChange={(e) => setRawNotes(e.target.value)}
              />
              
              <div className="absolute right-10 top-10 flex flex-col items-center gap-3">
                <button
                  onClick={isRecording ? handleStopRecording : handleStartRecording}
                  disabled={isTranscribing}
                  className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl ${
                    isRecording 
                      ? 'bg-rose-500 animate-pulse scale-110' 
                      : 'bg-[#1b4332] hover:bg-[#2d6a4f] hover:scale-105'
                  } text-white disabled:opacity-50`}
                >
                  {isTranscribing ? (
                    <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  ) : isRecording ? (
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" rx="1" /></svg>
                  ) : (
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" /></svg>
                  )}
                </button>
                {isRecording && <span className="text-rose-500 text-[10px] font-bold uppercase tracking-widest animate-pulse">Recording</span>}
                {isTranscribing && <span className="text-[#52b788] text-[10px] font-bold uppercase tracking-widest">Typing...</span>}
              </div>

              <div className="mt-12 flex flex-col md:flex-row items-center justify-between gap-10">
                <p className="text-slate-400 text-sm font-medium">Record a memo and let AI organize it.</p>
                <div className="flex gap-4 w-full md:w-auto">
                  {status === AppStatus.POLISHING && (
                    <Button variant="outline" onClick={cancelAllProcessing} className="text-rose-500 border-rose-100 bg-rose-50">
                      Cancel
                    </Button>
                  )}
                  <Button onClick={handlePolish} isLoading={status === AppStatus.POLISHING} size="large" className="w-full md:w-auto min-w-[320px]">
                    Polish My Idea
                  </Button>
                </div>
              </div>
            </div>
          </section>
        )}

        {error && (
          <div className="mt-8 p-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl text-center font-medium animate-in slide-in-from-top-4">
            {error}
            <button onClick={() => setError(null)} className="ml-3 underline opacity-60 hover:opacity-100">Dismiss</button>
          </div>
        )}

        {status === AppStatus.SUCCESS && (
          <div id="result-section" className="mt-8 space-y-8 animate-in slide-in-from-bottom-8 duration-700">
            <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
              <div className="p-4 md:p-6 bg-[#fbfaf5] border-b border-slate-100 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 text-[#1b4332] font-bold uppercase tracking-wider text-xs">
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" /></svg>
                    Draft Finalized
                  </div>
                  <span className="bg-[#1b4332]/10 text-[#1b4332] px-2 py-0.5 rounded-full text-[10px] font-bold uppercase">{category}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={handleArchive} isLoading={isArchiving} className={`py-2 px-4 text-xs ${archiveSuccess ? 'text-emerald-600 border-emerald-200 bg-emerald-50' : ''}`}>
                    {archiveSuccess ? '✓ Saved' : 'Cloud Sync'}
                  </Button>
                  <Button variant="secondary" onClick={() => setIsEmailModalOpen(true)} className="py-2 px-4 text-xs">Email Me</Button>
                  <Button variant="outline" onClick={handleReset} className="py-2 px-4 text-xs">New Idea</Button>
                </div>
              </div>
              <div className="p-8 md:p-12 overflow-y-auto max-h-[70vh]">
                <MarkdownRenderer content={polishedContent} variant="emerald" />
              </div>
            </div>
            {expansionContent && (
              <div className="bg-[#f0f9ff] rounded-3xl border-2 border-[#bae6fd] p-8 md:p-10 shadow-lg animate-in fade-in zoom-in duration-500 delay-300">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-[#0ea5e9] text-white rounded-full flex items-center justify-center shadow-md"><span>🚀</span></div>
                  <div>
                    <h3 className="text-xl font-bold text-[#0369a1]">Expansion Strategy</h3>
                    <p className="text-sm text-[#0ea5e9] font-medium tracking-widest">AI Generated Opportunities</p>
                  </div>
                </div>
                <MarkdownRenderer content={expansionContent} variant="sky" />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
