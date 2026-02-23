import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Settings, Camera, Mic, Play, Square, Activity, Send, X, Upload, Trash2, ArrowLeft, File as FileIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';

type Message = {
    id: string;
    role: 'user' | 'ai' | 'system';
    content: string;
    timestamp: Date;
    media?: {
        image?: string;
        audio?: string;
    }
};

type TrainingFile = {
    id: string;
    name: string;
    type: string;
    size: number;
    base64Data: string;
    mimeType: string;
};

const DEFAULT_SYSTEM_PROMPT = `You are an expert modular synthesizer assistant, but you are also fully capable of recognizing and understanding any general visual or audio content (e.g., people, furniture, speech, environment). 
You have deep knowledge of modular synthesis theory, Eurorack modules, and sound design. 
When analyzing the provided image and audio:
1. Describe what you see and hear generally.
2. If modular synthesizers or related audio are present, provide specific, actionable instructions to the human operator to improve or evolve the sound. 
3. If the input has nothing to do with music/synth sound, just make a simple analysis to the input content then over. Be cool.
Format your response clearly. Keep it precise, neat, and concise. Do not feedback too many nonsenses or unneeded words.`;

const AudioVisualizer = ({ stream }: { stream: MediaStream | null }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    useEffect(() => {
        if (!stream || !canvasRef.current) return;
        
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) return;
        
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const canvas = canvasRef.current;
        const canvasCtx = canvas.getContext('2d')!;
        
        let animationId: number;
        
        const draw = () => {
            animationId = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);
            
            canvasCtx.fillStyle = '#141414';
            canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
            
            const barWidth = (canvas.width / bufferLength) * 2.5;
            let barHeight;
            let x = 0;
            
            for (let i = 0; i < bufferLength; i++) {
                barHeight = dataArray[i] / 2;
                
                const r = Math.min(255, barHeight + 150);
                const g = Math.min(255, barHeight + 50);
                const b = 30;
                
                canvasCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                
                x += barWidth + 1;
            }
        };
        
        draw();
        
        return () => {
            cancelAnimationFrame(animationId);
            source.disconnect();
            if (audioCtx.state !== 'closed') {
                audioCtx.close();
            }
        };
    }, [stream]);
    
    return <canvas ref={canvasRef} className="w-full h-full" width={800} height={200} />;
};

export default function App() {
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
    const [showSettings, setShowSettings] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [userInput, setUserInput] = useState('');
    const [deviceError, setDeviceError] = useState<string | null>(null);
    const [trainingFiles, setTrainingFiles] = useState<TrainingFile[]>([]);
    const [skillFiles, setSkillFiles] = useState<TrainingFile[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const skillInputRef = useRef<HTMLInputElement>(null);
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
    const [recordedAudioBase64, setRecordedAudioBase64] = useState<string | null>(null);
    const [recordedAudioMimeType, setRecordedAudioMimeType] = useState<string | null>(null);
    const [capturedImageBase64, setCapturedImageBase64] = useState<string | null>(null);
    const [capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null);

    const startStream = async () => {
        setDeviceError(null);
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setStream(mediaStream);
            setIsStreaming(true);
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
            }
            
            // Start recording automatically when stream starts
            recordedChunksRef.current = [];
            const audioTrack = mediaStream.getAudioTracks()[0];
            if (audioTrack) {
                const audioOnlyStream = new MediaStream([audioTrack]);
                let options: MediaRecorderOptions | undefined = undefined;
                if (MediaRecorder.isTypeSupported('audio/webm')) {
                    options = { mimeType: 'audio/webm' };
                } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                    options = { mimeType: 'audio/mp4' };
                }
                
                const mediaRecorder = new MediaRecorder(audioOnlyStream, options);
                mediaRecorderRef.current = mediaRecorder;
                
                mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) {
                        recordedChunksRef.current.push(e.data);
                    }
                };
                
                mediaRecorder.onstop = () => {
                    if (recordedChunksRef.current.length > 0) {
                        const blob = new Blob(recordedChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
                        const url = URL.createObjectURL(blob);
                        setRecordedAudioUrl(url);
                        
                        const reader = new FileReader();
                        reader.readAsDataURL(blob);
                        reader.onloadend = () => {
                            const base64data = reader.result as string;
                            const [prefix, data] = base64data.split(',');
                            setRecordedAudioMimeType(prefix.split(':')[1].split(';')[0]);
                            setRecordedAudioBase64(data);
                        };
                    }
                };
                
                mediaRecorder.start();
                setIsRecording(true);
            }
            
        } catch (err: any) {
            console.error("Error accessing media devices:", err);
            setDeviceError(`Could not access camera and microphone: ${err.message || 'Permission denied'}. Please check your browser and system permissions.`);
        }
    };

    const stopStream = () => {
        // Capture one image right before stopping
        if (videoRef.current) {
            const canvas = document.createElement('canvas');
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
                const url = canvas.toDataURL('image/jpeg', 0.8);
                setCapturedImageUrl(url);
                setCapturedImageBase64(url.split(',')[1]);
            }
        }

        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        setIsRecording(false);

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
            setIsStreaming(false);
            if (videoRef.current) {
                videoRef.current.srcObject = null;
            }
        }
    };

    const handleAnalyze = async (textPrompt?: string) => {
        if (!capturedImageBase64 && !recordedAudioBase64) {
            alert("Please START and STOP recording first to capture audio and video.");
            return;
        }
        
        setIsAnalyzing(true);
        const promptText = textPrompt || "Analyze the captured sound and image, and give me the next instruction.";
        setUserInput('');
        
        try {
            const newUserMsg: Message = {
                id: Date.now().toString(),
                role: 'user',
                content: promptText,
                timestamp: new Date(),
                media: {
                    image: capturedImageUrl || undefined,
                    audio: recordedAudioUrl || undefined
                }
            };
            setMessages(prev => [...prev, newUserMsg]);
            
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const parts: any[] = [];
            
            for (const file of trainingFiles) {
                parts.push({ inlineData: { mimeType: file.mimeType, data: file.base64Data } });
            }
            
            for (const file of skillFiles) {
                parts.push({ inlineData: { mimeType: file.mimeType, data: file.base64Data } });
            }
            
            if (capturedImageBase64) {
                parts.push({ inlineData: { mimeType: 'image/jpeg', data: capturedImageBase64 } });
            }
            if (recordedAudioBase64 && recordedAudioMimeType) {
                parts.push({ inlineData: { mimeType: recordedAudioMimeType, data: recordedAudioBase64 } });
            }
            parts.push({ text: promptText });
            
            const response = await ai.models.generateContent({
                model: 'gemini-3.1-pro-preview',
                contents: { parts },
                config: {
                    systemInstruction: systemPrompt,
                }
            });
            
            const newAiMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'ai',
                content: response.text || "No response.",
                timestamp: new Date()
            };
            setMessages(prev => [...prev, newAiMsg]);
            
            // Clear captured media after sending
            setCapturedImageBase64(null);
            setCapturedImageUrl(null);
            setRecordedAudioBase64(null);
            setRecordedAudioUrl(null);
            setRecordedAudioMimeType(null);
            
        } catch (err) {
            console.error("Analysis error:", err);
            const errorMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'system',
                content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
                timestamp: new Date()
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-[#0a0a0a] text-white font-sans overflow-hidden">
            <header className="flex items-center justify-between p-4 border-b border-white/10 bg-[#141414] shrink-0">
                <div className="flex items-center gap-3">
                    <Activity className="w-6 h-6 text-[#F27D26]" />
                    <h1 className="text-xl font-semibold tracking-tight">Generasia: PATCH</h1>
                </div>
                <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                    <Settings className="w-5 h-5" />
                </button>
            </header>
            
            <main className="flex-1 overflow-hidden flex flex-col md:flex-row">
                <div className="w-full md:w-1/2 lg:w-5/12 border-r border-white/10 flex flex-col bg-[#050505]">
                    <div className="p-4 flex justify-between items-center border-b border-white/10 shrink-0">
                        <h2 className="font-mono text-xs uppercase tracking-widest text-white/50">Sensors</h2>
                        <button 
                            onClick={isStreaming ? stopStream : startStream}
                            className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-colors ${isStreaming ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' : 'bg-[#F27D26]/20 text-[#F27D26] hover:bg-[#F27D26]/30'}`}
                        >
                            {isStreaming ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                            {isStreaming ? 'STOP' : 'START'}
                        </button>
                    </div>
                    
                    <div className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto">
                        {deviceError && (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm font-sans">
                                {deviceError}
                            </div>
                        )}
                        <div className="relative aspect-video bg-[#141414] rounded-xl overflow-hidden border border-white/5 shadow-2xl shrink-0">
                            {!isStreaming && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/30">
                                    <Camera className="w-12 h-12 mb-2 opacity-50" />
                                    <span className="font-mono text-xs uppercase tracking-widest">Camera Offline</span>
                                </div>
                            )}
                            <video 
                                ref={videoRef} 
                                autoPlay 
                                playsInline 
                                muted 
                                className={`w-full h-full object-cover ${isStreaming ? 'opacity-100' : 'opacity-0'}`}
                            />
                            {isStreaming && (
                                <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/50 backdrop-blur-md px-2 py-1 rounded-md">
                                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                    <span className="font-mono text-[10px] uppercase tracking-wider text-white/80">REC</span>
                                </div>
                            )}
                        </div>
                        
                        <div className="h-32 bg-[#141414] rounded-xl overflow-hidden border border-white/5 relative shrink-0">
                            {!isStreaming && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/30">
                                    <Mic className="w-8 h-8 mb-2 opacity-50" />
                                    <span className="font-mono text-xs uppercase tracking-widest">Mic Offline</span>
                                </div>
                            )}
                            {isStreaming && <AudioVisualizer stream={stream} />}
                        </div>
                    </div>
                </div>
                
                <div className="w-full md:w-1/2 lg:w-7/12 flex flex-col bg-[#0a0a0a]">
                    <div className="p-4 border-b border-white/10 flex justify-between items-center bg-[#141414] shrink-0">
                        <h2 className="font-mono text-xs uppercase tracking-widest text-white/50">Command Log</h2>
                        {isAnalyzing && (
                            <div className="flex items-center gap-2 text-[#F27D26]">
                                <Activity className="w-4 h-4 animate-spin" />
                                <span className="font-mono text-xs uppercase tracking-widest">Analyzing...</span>
                            </div>
                        )}
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                        {messages.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-white/30">
                                <Activity className="w-16 h-16 mb-4 opacity-20" />
                                <p className="font-mono text-sm text-center max-w-md">
                                    Click START to begin recording audio. Click STOP to finish recording and capture an image. Then click Analyze.
                                </p>
                            </div>
                        ) : (
                            messages.map(msg => (
                                <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    <div className={`max-w-[85%] rounded-2xl p-4 ${
                                        msg.role === 'user' 
                                            ? 'bg-[#2a2a2a] border border-white/10' 
                                            : msg.role === 'system'
                                                ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                                                : 'bg-[#141414] border border-[#F27D26]/30'
                                    }`}>
                                        <div className="flex items-center gap-2 mb-2 opacity-50">
                                            <span className="font-mono text-[10px] uppercase tracking-wider">
                                                {msg.role === 'user' ? 'Human' : msg.role === 'ai' ? 'Generasia' : 'System'}
                                            </span>
                                            <span className="font-mono text-[10px]">{msg.timestamp.toLocaleTimeString()}</span>
                                        </div>
                                        
                                        {msg.media && (
                                            <div className="flex gap-2 mb-3">
                                                {msg.media.image && (
                                                    <img src={msg.media.image} alt="Captured frame" className="w-24 h-24 object-cover rounded-lg border border-white/10" />
                                                )}
                                                {msg.media.audio && (
                                                    <audio src={msg.media.audio} controls className="h-24 w-48" />
                                                )}
                                            </div>
                                        )}
                                        
                                        <div className="font-sans leading-relaxed text-sm space-y-2">
                                            <ReactMarkdown
                                                components={{
                                                    p: ({node, ...props}) => <p className="mb-2" {...props} />,
                                                    ul: ({node, ...props}) => <ul className="list-disc pl-4 mb-2" {...props} />,
                                                    ol: ({node, ...props}) => <ol className="list-decimal pl-4 mb-2" {...props} />,
                                                    li: ({node, ...props}) => <li className="mb-1" {...props} />,
                                                    strong: ({node, ...props}) => <strong className="font-semibold text-[#F27D26]" {...props} />,
                                                    code: ({node, ...props}) => <code className="font-mono text-xs bg-black/50 px-1 py-0.5 rounded" {...props} />,
                                                }}
                                            >
                                                {msg.content}
                                            </ReactMarkdown>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                    
                    <div className="p-4 border-t border-white/10 bg-[#141414] shrink-0">
                        <div className="flex gap-2">
                            <input 
                                type="text" 
                                value={userInput}
                                onChange={e => setUserInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAnalyze(userInput)}
                                placeholder="Type a message or just click Analyze..."
                                className="flex-1 bg-[#050505] border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#F27D26]/50 transition-colors font-sans"
                                disabled={!isStreaming || isAnalyzing}
                            />
                            <button 
                                onClick={() => handleAnalyze(userInput)}
                                disabled={(!capturedImageBase64 && !recordedAudioBase64) || isAnalyzing}
                                className="bg-[#F27D26] hover:bg-[#F27D26]/90 text-black px-6 py-3 rounded-xl font-semibold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isAnalyzing ? (
                                    <Activity className="w-5 h-5 animate-spin" />
                                ) : (
                                    <>
                                        <span>Analyze</span>
                                        <Send className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </main>
            
            <AnimatePresence>
                {showSettings && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
                    >
                        <motion.div 
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl relative"
                        >
                            <div className="p-4 border-b border-white/10 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <button 
                                        onClick={() => setShowSettings(false)} 
                                        className="text-white/50 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
                                        aria-label="Go Back"
                                    >
                                        <ArrowLeft className="w-5 h-5" />
                                    </button>
                                    <h2 className="font-mono text-sm uppercase tracking-widest">System Configuration</h2>
                                </div>
                                <button 
                                    onClick={() => setShowSettings(false)} 
                                    className="text-white/50 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
                                    aria-label="Close settings"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-6 flex flex-col gap-6 max-h-[70vh] overflow-y-auto">
                                <div>
                                    <label className="block font-mono text-xs uppercase tracking-widest text-white/50 mb-2">
                                        Gemini API Key
                                    </label>
                                    <div className="bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-sm text-white/50 font-mono">
                                        Managed automatically by AI Studio Environment
                                    </div>
                                    <p className="text-xs text-white/30 mt-2">
                                        The API key is securely injected at runtime. You do not need to configure it here.
                                    </p>
                                </div>
                                
                                <div>
                                    <label className="block font-mono text-xs uppercase tracking-widest text-white/50 mb-2">
                                        Grand Prompt (System Instruction)
                                    </label>
                                    <textarea 
                                        value={systemPrompt}
                                        onChange={e => setSystemPrompt(e.target.value)}
                                        className="w-full h-48 bg-[#050505] border border-white/10 rounded-lg p-4 text-sm focus:outline-none focus:border-[#F27D26]/50 transition-colors font-sans leading-relaxed resize-none"
                                    />
                                    <p className="text-xs text-white/30 mt-2">
                                        This prompt acts as the "brain" of the AI, containing modular synth theory and operation manuals.
                                    </p>
                                </div>
                                <div>
                                    <label className="block font-mono text-xs uppercase tracking-widest text-white/50 mb-2">
                                        Training Materials Database
                                    </label>
                                    <div className="bg-[#050505] border border-white/10 rounded-lg p-4">
                                        <div className="flex justify-between items-center mb-4">
                                            <p className="text-xs text-white/50">Upload manuals, images, or audio for the AI to reference.</p>
                                            <input 
                                                type="file" 
                                                ref={fileInputRef}
                                                className="hidden" 
                                                multiple 
                                                onChange={(e) => {
                                                    const files = Array.from(e.target.files || []);
                                                    files.forEach(file => {
                                                        const reader = new FileReader();
                                                        reader.onloadend = () => {
                                                            const base64data = reader.result as string;
                                                            const [prefix, data] = base64data.split(',');
                                                            const mimeType = prefix.split(':')[1].split(';')[0];
                                                            
                                                            setTrainingFiles(prev => [...prev, {
                                                                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                                                                name: file.name,
                                                                type: file.type,
                                                                size: file.size,
                                                                base64Data: data,
                                                                mimeType: mimeType
                                                            }]);
                                                        };
                                                        reader.readAsDataURL(file);
                                                    });
                                                    if (fileInputRef.current) fileInputRef.current.value = '';
                                                }}
                                            />
                                            <button 
                                                onClick={() => fileInputRef.current?.click()}
                                                className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors"
                                            >
                                                <Upload className="w-4 h-4" />
                                                Upload Files
                                            </button>
                                        </div>
                                        
                                        {trainingFiles.length > 0 ? (
                                            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                                {trainingFiles.map(file => (
                                                    <div key={file.id} className="flex items-center justify-between bg-[#141414] p-3 rounded-lg border border-white/5">
                                                        <div className="flex items-center gap-3 overflow-hidden">
                                                            <FileIcon className="w-4 h-4 text-[#F27D26] shrink-0" />
                                                            <div className="truncate">
                                                                <p className="text-sm truncate">{file.name}</p>
                                                                <p className="text-[10px] text-white/40 font-mono">{(file.size / 1024).toFixed(1)} KB</p>
                                                            </div>
                                                        </div>
                                                        <button 
                                                            onClick={() => setTrainingFiles(prev => prev.filter(f => f.id !== file.id))}
                                                            className="text-white/30 hover:text-red-400 p-2 rounded-full hover:bg-white/5 transition-colors shrink-0"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-center py-8 border-2 border-dashed border-white/10 rounded-lg">
                                                <p className="text-sm text-white/30">No training materials uploaded yet.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                
                                <div>
                                    <label className="block font-mono text-xs uppercase tracking-widest text-white/50 mb-2">
                                        Skills Database (.md)
                                    </label>
                                    <div className="bg-[#050505] border border-white/10 rounded-lg p-4">
                                        <div className="flex justify-between items-center mb-4">
                                            <p className="text-xs text-white/50">Upload .md files to enable specific skills.</p>
                                            <input 
                                                type="file" 
                                                ref={skillInputRef}
                                                className="hidden" 
                                                multiple 
                                                accept=".md"
                                                onChange={(e) => {
                                                    const files = Array.from(e.target.files || []);
                                                    files.forEach(file => {
                                                        const reader = new FileReader();
                                                        reader.onloadend = () => {
                                                            const base64data = reader.result as string;
                                                            const [prefix, data] = base64data.split(',');
                                                            let mimeType = prefix.split(':')[1].split(';')[0];
                                                            
                                                            // Fallback for markdown if not properly detected
                                                            if (!mimeType || mimeType === 'application/octet-stream') {
                                                                mimeType = 'text/markdown';
                                                            }
                                                            
                                                            setSkillFiles(prev => [...prev, {
                                                                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                                                                name: file.name,
                                                                type: file.type,
                                                                size: file.size,
                                                                base64Data: data,
                                                                mimeType: mimeType
                                                            }]);
                                                        };
                                                        reader.readAsDataURL(file);
                                                    });
                                                    if (skillInputRef.current) skillInputRef.current.value = '';
                                                }}
                                            />
                                            <button 
                                                onClick={() => skillInputRef.current?.click()}
                                                className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors"
                                            >
                                                <Upload className="w-4 h-4" />
                                                Upload Skills
                                            </button>
                                        </div>
                                        
                                        {skillFiles.length > 0 ? (
                                            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                                {skillFiles.map(file => (
                                                    <div key={file.id} className="flex items-center justify-between bg-[#141414] p-3 rounded-lg border border-white/5">
                                                        <div className="flex items-center gap-3 overflow-hidden">
                                                            <FileIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                                                            <div className="truncate">
                                                                <p className="text-sm truncate">{file.name}</p>
                                                                <p className="text-[10px] text-white/40 font-mono">{(file.size / 1024).toFixed(1)} KB</p>
                                                            </div>
                                                        </div>
                                                        <button 
                                                            onClick={() => setSkillFiles(prev => prev.filter(f => f.id !== file.id))}
                                                            className="text-white/30 hover:text-red-400 p-2 rounded-full hover:bg-white/5 transition-colors shrink-0"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-center py-8 border-2 border-dashed border-white/10 rounded-lg">
                                                <p className="text-sm text-white/30">No skills uploaded yet.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="p-4 border-t border-white/10 flex justify-between items-center">
                                <button 
                                    onClick={() => setShowSettings(false)}
                                    className="text-white/50 hover:text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                                >
                                    <ArrowLeft className="w-4 h-4" />
                                    Go Back
                                </button>
                                <button 
                                    onClick={() => setShowSettings(false)}
                                    className="bg-white text-black px-6 py-2 rounded-lg font-medium hover:bg-white/90 transition-colors"
                                >
                                    Save & Close
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
