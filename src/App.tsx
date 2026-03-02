import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Settings, Camera, Mic, Play, Square, Activity, Send, X, Upload, Trash2, ArrowLeft, File as FileIcon, History, Edit2, Check } from 'lucide-react';
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

CRITICAL FORMATTING REQUIREMENT:
You MUST separate your response into two distinct sections using these exact headers:
ANALYSIS:
(Your general analysis here)
INSTRUCTIONS:
(10 steps each time, present your step-by-step instructions here, each step contains 3 rows as the 1 and 2 situations below describe, print 1 step (3 rows) at a time. 'output' in orange, 'input' in blue, 'module name' and 'knob name' in green, 'module parameter' and 'parameter value' in pink, 'thought' in white, and all the specific content characters in white)

To achieve the colors, you MUST wrap the text in these exact XML tags:
<orange>output</orange>
<blue>input</blue>
<green>module name</green> or <green>knob name</green>
<pink>module parameter</pink> or <pink>parameter value</pink>
<white>thought</white>

Follow the following format each time you send a step instruction:
1. if it's a cable plugging task, print as the following format:
<orange>output</orange>: <green>[module name]</green> — <pink>[module parameter]</pink>; 
<blue>input</blue>: <green>[module name]</green> — <pink>[module parameter]</pink>; 
<white>[a few words describing your thought]</white>.

2. if it's a parameter adjustment task, print as the following format:
<green>[module name]</green> — <green>[knob name]</green>; 
<pink>[parameter value]</pink>; 
<white>[a few words describing your thought]</white>.

3. if it's an other task:
just describe using natural language.

Make sure the 10 steps is a natural modular synth system operation process, instruct me to plug when it needs to plug and the same to parameter adjustment, don't separate plugging and adjusting parameters into 2 individual parts.
Separate each of the 10 steps with a blank line.

If there are no instructions, you can omit the INSTRUCTIONS: section. Keep it precise, neat, and concise. Do not feedback too many nonsenses or unneeded words.

Remember: we have many stackable cables, use it boldly if needed.`;

type Performance = {
    id: string;
    name: string;
    createdAt: string;
    messages: Message[];
};

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

const colorizeText = (text: string) => {
    let cleanText = text.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, '');
    
    const regex = /<(orange|blue|green|pink|white)>(.*?)<\/\1>/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    
    while ((match = regex.exec(cleanText)) !== null) {
        if (match.index > lastIndex) {
            parts.push(cleanText.substring(lastIndex, match.index));
        }
        const color = match[1];
        const content = match[2];
        let colorClass = '';
        switch(color) {
            case 'orange': colorClass = 'text-[#F27D26]'; break;
            case 'blue': colorClass = 'text-blue-400'; break;
            case 'green': colorClass = 'text-green-400'; break;
            case 'pink': colorClass = 'text-pink-400'; break;
            case 'white': colorClass = 'text-white'; break;
        }
        parts.push(<span key={match.index} className={`${colorClass} font-bold`}>{content}</span>);
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < cleanText.length) {
        parts.push(cleanText.substring(lastIndex));
    }
    return <div className="whitespace-pre-wrap leading-relaxed">{parts}</div>;
};

const AIMessageView = ({ content }: { content: string }) => {
    const [visibleSteps, setVisibleSteps] = useState(0);
    
    let analysis = content;
    let instructions: string[] = [];
    
    const instructionMatch = content.match(/INSTRUCTIONS:\s*([\s\S]*)/i);
    const analysisMatch = content.match(/ANALYSIS:\s*([\s\S]*?)(?:INSTRUCTIONS:|$)/i);
    
    if (instructionMatch) {
        if (analysisMatch) {
            analysis = analysisMatch[1].trim();
        } else {
            analysis = content.substring(0, instructionMatch.index).trim();
        }
        
        instructions = instructionMatch[1]
            .split(/\n\s*\n/)
            .map(s => s.trim())
            .filter(s => s.length > 0);
    } else if (analysisMatch) {
        analysis = analysisMatch[1].trim();
    }

    return (
        <div className="flex flex-col gap-4 w-full">
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
                    {analysis}
                </ReactMarkdown>
            </div>
            {instructions.length > 0 && (
                <div className="mt-2 border-t border-white/10 pt-4">
                    <h3 className="font-mono text-xs uppercase tracking-widest text-[#F27D26] mb-4">Instructions</h3>
                    <div className="flex flex-col gap-3">
                        <AnimatePresence>
                            {instructions.slice(0, visibleSteps).map((step, i) => (
                                <motion.div 
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    key={i} 
                                    className="bg-[#050505] border border-white/10 p-5 rounded-xl text-lg font-medium text-white/90 shadow-lg"
                                >
                                    <div className="bg-[#050505] border border-white/10 p-5 rounded-xl text-lg font-medium text-white/90 shadow-lg">
                                        {colorizeText(step)}
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                    {visibleSteps < instructions.length && (
                        <button 
                            onClick={() => setVisibleSteps(prev => prev + 1)}
                            className="mt-4 w-full py-4 border border-dashed border-white/20 rounded-xl text-white/50 hover:text-white hover:border-[#F27D26]/50 hover:bg-[#F27D26]/5 transition-all font-mono text-sm uppercase tracking-widest flex items-center justify-center gap-2"
                        >
                            <span>Reveal Next Step</span>
                            <span className="bg-white/10 px-2 py-0.5 rounded text-xs">{visibleSteps}/{instructions.length}</span>
                        </button>
                    )}
                    {visibleSteps > 0 && visibleSteps === instructions.length && (
                        <div className="mt-4 text-center text-[#F27D26] font-mono text-xs uppercase tracking-widest opacity-50">
                            All steps revealed
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

function PerformanceView({ performance, onUpdate, onBack }: { performance: Performance, onUpdate: (p: Performance) => void, onBack: () => void }) {
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
    const [showSettings, setShowSettings] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [messages, setMessages] = useState<Message[]>(performance.messages);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [userInput, setUserInput] = useState('');
    const [deviceError, setDeviceError] = useState<string | null>(null);
    const [trainingFiles, setTrainingFiles] = useState<TrainingFile[]>([]);
    const [skillFiles, setSkillFiles] = useState<TrainingFile[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const skillInputRef = useRef<HTMLInputElement>(null);
    
    useEffect(() => {
        onUpdate({ ...performance, messages });
    }, [messages]);
    
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
        if (!capturedImageBase64 && !recordedAudioBase64 && !textPrompt?.trim()) {
            alert("Please START and STOP recording first to capture audio and video, or type a message.");
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
            const currentParts: any[] = [];
            
            for (const file of trainingFiles) {
                currentParts.push({ inlineData: { mimeType: file.mimeType, data: file.base64Data } });
            }
            
            for (const file of skillFiles) {
                currentParts.push({ inlineData: { mimeType: file.mimeType, data: file.base64Data } });
            }
            
            if (capturedImageBase64) {
                currentParts.push({ inlineData: { mimeType: 'image/jpeg', data: capturedImageBase64 } });
            }
            if (recordedAudioBase64 && recordedAudioMimeType) {
                currentParts.push({ inlineData: { mimeType: recordedAudioMimeType, data: recordedAudioBase64 } });
            }
            currentParts.push({ text: promptText });
            
            const historyContents: any[] = [];
            let lastRole = '';
            
            const recentMessages = messages
                .filter(msg => msg.role === 'user' || msg.role === 'ai')
                .slice(-10);
                
            for (const msg of recentMessages) {
                const role = msg.role === 'ai' ? 'model' : 'user';
                if (role !== lastRole) {
                    historyContents.push({
                        role,
                        parts: [{ text: msg.content }]
                    });
                    lastRole = role;
                } else {
                    historyContents[historyContents.length - 1].parts.push({ text: msg.content });
                }
            }
            
            if (historyContents.length > 0 && historyContents[0].role === 'model') {
                historyContents.shift();
            }
            
            if (historyContents.length > 0 && historyContents[historyContents.length - 1].role === 'user') {
                historyContents[historyContents.length - 1].parts.push(...currentParts);
            } else {
                historyContents.push({
                    role: 'user',
                    parts: currentParts
                });
            }
            
            const response = await ai.models.generateContent({
                model: 'gemini-3.1-pro-preview',
                contents: historyContents,
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
                    <button onClick={onBack} className="p-2 hover:bg-white/10 rounded-full transition-colors mr-2" aria-label="Back to Dashboard">
                        <ArrowLeft className="w-5 h-5 text-white/70" />
                    </button>
                    <Activity className="w-6 h-6 text-[#F27D26]" />
                    <h1 className="text-xl font-semibold tracking-tight">{performance.name}</h1>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setShowHistory(true)} className="p-2 hover:bg-white/10 rounded-full transition-colors" aria-label="History">
                        <History className="w-5 h-5" />
                    </button>
                    <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-white/10 rounded-full transition-colors" aria-label="Settings">
                        <Settings className="w-5 h-5" />
                    </button>
                </div>
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
                            messages.slice(-10).map(msg => (
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
                                        
                                        <div className="font-sans leading-relaxed text-sm space-y-2 w-full">
                                            {msg.role === 'ai' ? (
                                                <AIMessageView content={msg.content} />
                                            ) : (
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
                                            )}
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
                                disabled={isAnalyzing}
                            />
                            <button 
                                onClick={() => handleAnalyze(userInput)}
                                disabled={(!capturedImageBase64 && !recordedAudioBase64 && !userInput.trim()) || isAnalyzing}
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
                {showHistory && (
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
                            className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden shadow-2xl relative"
                        >
                            <div className="p-4 border-b border-white/10 flex justify-between items-center shrink-0">
                                <div className="flex items-center gap-3">
                                    <History className="w-5 h-5 text-[#F27D26]" />
                                    <h2 className="font-mono text-sm uppercase tracking-widest">Analysis History</h2>
                                </div>
                                <button 
                                    onClick={() => setShowHistory(false)} 
                                    className="text-white/50 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
                                    aria-label="Close history"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-6 flex-1 overflow-y-auto flex flex-col gap-6">
                                {messages.filter(m => m.role === 'ai').slice(-10).length === 0 ? (
                                    <div className="text-center py-12 text-white/30 font-mono text-sm">
                                        No historical analysis available yet.
                                    </div>
                                ) : (
                                    messages.filter(m => m.role === 'ai').slice(-10).reverse().map((msg, index, arr) => (
                                        <div key={msg.id} className="bg-[#050505] border border-white/10 rounded-xl p-4">
                                            <div className="flex justify-between items-center mb-3 pb-3 border-b border-white/5">
                                                <span className="font-mono text-xs text-[#F27D26]">Analysis #{arr.length - index}</span>
                                                <span className="font-mono text-[10px] text-white/40">{msg.timestamp.toLocaleString()}</span>
                                            </div>
                                            <div className="font-sans text-sm leading-relaxed text-white/80 w-full">
                                                <AIMessageView content={msg.content} />
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

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

export default function App() {
    const [performances, setPerformances] = useState<Performance[]>([]);
    const [currentPerformanceId, setCurrentPerformanceId] = useState<string | null>(null);
    const [editingPerformanceId, setEditingPerformanceId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");

    // Load performances from local storage on mount
    useEffect(() => {
        const saved = localStorage.getItem('generasia_performances');
        if (saved) {
            try {
                setPerformances(JSON.parse(saved));
            } catch (e) {
                console.error("Failed to parse saved performances", e);
            }
        }
    }, []);

    // Save performances to local storage whenever they change
    useEffect(() => {
        localStorage.setItem('generasia_performances', JSON.stringify(performances));
    }, [performances]);

    const handleCreatePerformance = () => {
        const newPerformance: Performance = {
            id: Date.now().toString(),
            name: `Performance ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
            createdAt: new Date().toISOString(),
            messages: []
        };
        setPerformances(prev => [newPerformance, ...prev]);
        setCurrentPerformanceId(newPerformance.id);
    };

    const handleDeletePerformance = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this performance?')) {
            setPerformances(prev => prev.filter(p => p.id !== id));
            if (currentPerformanceId === id) {
                setCurrentPerformanceId(null);
            }
        }
    };

    const handleExportPerformance = (performance: Performance, e: React.MouseEvent) => {
        e.stopPropagation();
        
        let exportHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Performance Export: ${performance.name}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 2rem; background: #f9f9f9; }
        .header { border-bottom: 2px solid #eee; padding-bottom: 1rem; margin-bottom: 2rem; }
        h1 { color: #111; margin-bottom: 0.5rem; }
        .meta { color: #666; font-size: 0.9rem; }
        .message { background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .message-header { font-weight: bold; color: #F27D26; margin-bottom: 1rem; border-bottom: 1px solid #eee; padding-bottom: 0.5rem; }
        pre { white-space: pre-wrap; font-family: inherit; margin: 0; }
        .no-data { color: #666; font-style: italic; }
        
        /* Custom tags styling */
        .tag-orange { color: #F27D26; font-weight: 500; }
        .tag-blue { color: #3b82f6; font-weight: 500; }
        .tag-green { color: #22c55e; font-weight: 500; }
        .tag-pink { color: #ec4899; font-weight: 500; }
        .tag-white { color: #333; font-style: italic; }
    </style>
</head>
<body>
    <div class="header">
        <h1>${performance.name}</h1>
        <div class="meta">Created: ${new Date(performance.createdAt).toLocaleString()}</div>
    </div>
`;
        
        const aiMessages = performance.messages.filter(m => m.role === 'ai');
        
        if (aiMessages.length === 0) {
            exportHtml += '<div class="no-data">No instructions generated yet.</div>';
        } else {
            aiMessages.forEach((msg, index) => {
                // Replace custom tags with styled spans
                let formattedContent = msg.content
                    .replace(/<orange>(.*?)<\/orange>/g, '<span class="tag-orange">$1</span>')
                    .replace(/<blue>(.*?)<\/blue>/g, '<span class="tag-blue">$1</span>')
                    .replace(/<green>(.*?)<\/green>/g, '<span class="tag-green">$1</span>')
                    .replace(/<pink>(.*?)<\/pink>/g, '<span class="tag-pink">$1</span>')
                    .replace(/<white>(.*?)<\/white>/g, '<span class="tag-white">$1</span>');

                exportHtml += `
    <div class="message">
        <div class="message-header">AI Response ${index + 1}</div>
        <pre>${formattedContent}</pre>
    </div>`;
            });
        }

        exportHtml += `
</body>
</html>`;

        const blob = new Blob([exportHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${performance.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_instructions.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleStartRename = (perf: Performance, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingPerformanceId(perf.id);
        setEditingName(perf.name);
    };

    const handleSaveRename = (e: React.MouseEvent | React.KeyboardEvent) => {
        e.stopPropagation();
        if (editingPerformanceId && editingName.trim()) {
            setPerformances(prev => prev.map(p => 
                p.id === editingPerformanceId ? { ...p, name: editingName.trim() } : p
            ));
        }
        setEditingPerformanceId(null);
    };

    const handleCancelRename = (e: React.MouseEvent | React.KeyboardEvent) => {
        e.stopPropagation();
        setEditingPerformanceId(null);
    };

    const handleUpdatePerformance = (updatedPerformance: Performance) => {
        setPerformances(prev => prev.map(p => p.id === updatedPerformance.id ? updatedPerformance : p));
    };

    const currentPerformance = performances.find(p => p.id === currentPerformanceId);

    if (currentPerformance) {
        return (
            <PerformanceView 
                performance={currentPerformance} 
                onUpdate={handleUpdatePerformance}
                onBack={() => setCurrentPerformanceId(null)}
            />
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white font-sans p-8 flex flex-col items-center">
            <div className="w-full max-w-4xl">
                <header className="flex items-center justify-between mb-12 border-b border-white/10 pb-6">
                    <div className="flex items-center gap-4">
                        <Activity className="w-8 h-8 text-[#F27D26]" />
                        <div>
                            <h1 className="text-3xl font-semibold tracking-tight">Generasia</h1>
                            <p className="text-white/50 font-mono text-xs uppercase tracking-widest mt-1">Performance Manager</p>
                        </div>
                    </div>
                    <button 
                        onClick={handleCreatePerformance}
                        className="bg-[#F27D26] text-black px-6 py-3 rounded-xl font-medium hover:bg-[#F27D26]/90 transition-colors flex items-center gap-2 shadow-lg shadow-[#F27D26]/20"
                    >
                        <span className="text-xl leading-none">+</span>
                        New Performance
                    </button>
                </header>

                <div className="grid gap-4">
                    {performances.length === 0 ? (
                        <div className="text-center py-20 border-2 border-dashed border-white/10 rounded-2xl bg-[#141414]">
                            <Activity className="w-16 h-16 mx-auto mb-4 opacity-20 text-[#F27D26]" />
                            <h3 className="text-xl font-medium mb-2">No Performances Yet</h3>
                            <p className="text-white/50 max-w-md mx-auto">
                                Create a new performance project to start analyzing your modular synth sessions and generating instructions.
                            </p>
                        </div>
                    ) : (
                        performances.map(perf => (
                            <motion.div 
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                key={perf.id}
                                onClick={() => setCurrentPerformanceId(perf.id)}
                                className="bg-[#141414] border border-white/10 p-6 rounded-2xl hover:border-[#F27D26]/50 transition-colors cursor-pointer group flex items-center justify-between"
                            >
                                <div>
                                    {editingPerformanceId === perf.id ? (
                                        <div className="flex items-center gap-2 mb-1" onClick={e => e.stopPropagation()}>
                                            <input
                                                type="text"
                                                value={editingName}
                                                onChange={(e) => setEditingName(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleSaveRename(e);
                                                    if (e.key === 'Escape') handleCancelRename(e);
                                                }}
                                                autoFocus
                                                className="bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-xl font-medium outline-none focus:border-[#F27D26]"
                                            />
                                            <button onClick={handleSaveRename} className="p-1 hover:bg-white/10 rounded text-green-400">
                                                <Check className="w-4 h-4" />
                                            </button>
                                            <button onClick={handleCancelRename} className="p-1 hover:bg-white/10 rounded text-red-400">
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ) : (
                                        <h3 className="text-xl font-medium mb-1 group-hover:text-[#F27D26] transition-colors">{perf.name}</h3>
                                    )}
                                    <p className="text-white/40 font-mono text-xs">
                                        Created: {new Date(perf.createdAt).toLocaleString()} • {perf.messages.filter(m => m.role === 'ai').length} AI Responses
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button 
                                        onClick={(e) => handleStartRename(perf, e)}
                                        className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-white/70 hover:text-white transition-colors"
                                        title="Rename Performance"
                                    >
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button 
                                        onClick={(e) => handleExportPerformance(perf, e)}
                                        className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-white/70 hover:text-white transition-colors flex items-center gap-2"
                                        title="Export Instructions to HTML File"
                                    >
                                        <FileIcon className="w-4 h-4" />
                                        <span className="text-sm font-medium">Export</span>
                                    </button>
                                    <button 
                                        onClick={(e) => handleDeletePerformance(perf.id, e)}
                                        className="p-3 bg-red-500/10 hover:bg-red-500/20 rounded-xl text-red-400 hover:text-red-300 transition-colors"
                                        title="Delete Performance"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}