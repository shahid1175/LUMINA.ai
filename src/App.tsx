import { useState, useEffect } from 'react';
import React from 'react';
import { 
  Plus, 
  History, 
  Settings, 
  LogOut, 
  Image as ImageIcon, 
  Sparkles, 
  Download, 
  Trash2,
  Maximize2,
  ChevronRight,
  Loader2,
  Github,
  Zap,
  LayoutGrid,
  Monitor
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db } from './lib/firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  doc,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore';
import { cn } from './lib/utils';

// --- Types ---
interface GeneratedAsset {
  id: string;
  url: string;
  prompt: string;
  type: 'image' | 'video';
  aspectRatio: string;
  model: string;
  createdAt: any;
}

// --- Components ---

const Button = ({ 
  children, 
  className, 
  variant = 'primary', 
  size = 'md',
  isLoading = false,
  ...props 
}: any) => {
  const variants = {
    primary: 'bg-accent-primary text-white font-bold hover:bg-accent-hover shadow-lg shadow-accent-primary/20',
    secondary: 'bg-dark-700 text-slate-200 hover:bg-dark-600 ui-border',
    outline: 'border border-white/10 hover:border-accent-primary/50 text-slate-400 hover:text-white',
    ghost: 'hover:bg-white/5 text-slate-500 hover:text-slate-200',
    danger: 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-4 text-base'
  };

  return (
    <button 
      disabled={isLoading || props.disabled}
      className={cn(
        'inline-flex items-center justify-center rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed font-medium',
        variants[variant as keyof typeof variants],
        sizes[size as keyof typeof sizes],
        className
      )}
      {...props}
    >
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
      {children}
    </button>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [currentAsset, setCurrentAsset] = useState<GeneratedAsset | null>(null);
  const [history, setHistory] = useState<GeneratedAsset[]>([]);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [enhancing, setEnhancing] = useState(false);
  const [isAssetLoading, setIsAssetLoading] = useState(true);
  const [mode, setMode] = useState<'image' | 'video' | 'image-to-video'>('image');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Reset asset loading state when current asset changes
  useEffect(() => {
    setIsAssetLoading(true);
  }, [currentAsset?.id]);

  // History Listener
  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const q = query(
      collection(db, "images"), // Keeping collection name 'images' but storing videos too
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(d => {
        const data = d.data();
        return { 
          id: d.id, 
          ...data,
          url: data.url || data.imageUrl // Support both field names
        } as GeneratedAsset;
      });
      setHistory(items);
      if (items.length > 0 && !currentAsset) {
        setCurrentAsset(items[0]);
      }
    });

    return unsubscribe;
  }, [user]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setCurrentAsset(null);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setMode('image-to-video');
    }
  };

  const generateAsset = async () => {
    if (!prompt || generating) return;
    setGenerating(true);

    try {
      let endpoint = "/api/generate";
      let body: any = { prompt, aspectRatio };

      if (mode === 'video') {
         endpoint = "/api/generate-video";
      } else if (mode === 'image-to-video') {
         endpoint = "/api/image-to-video";
         if (selectedFile) {
            const base64 = await new Promise((resolve) => {
               const reader = new FileReader();
               reader.onloadend = () => resolve(reader.result);
               reader.readAsDataURL(selectedFile);
            });
            body.image = base64;
         }
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      let finalUrl = data.url;

      // Handle video polling
      if (data.operationName) {
         let isDone = false;
         while (!isDone) {
            // Poll every 5 seconds
            await new Promise(r => setTimeout(r, 5000));
            const statusRes = await fetch("/api/video-status", {
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify({ operationName: data.operationName }),
            });
            const statusData = await statusRes.json();
            if (statusData.error) throw new Error(statusData.error.message || "Video generation failed");
            if (statusData.done) {
               isDone = true;
               finalUrl = `/api/video-download?operationName=${encodeURIComponent(data.operationName)}`;
            }
         }
      }

      // Save to Firestore
      if (user) {
        const type = (mode === 'image' && !data.operationName) ? 'image' : 'video';
        const model = mode === 'image' ? "Flux Architecture v2.5" : "Veo Kinetic v1.0";
        
        const docRef = await addDoc(collection(db, "images"), {
          userId: user.uid,
          prompt,
          url: finalUrl,
          type,
          aspectRatio,
          model,
          createdAt: serverTimestamp(),
        });
        
        setCurrentAsset({
           id: docRef.id,
           url: finalUrl,
           prompt,
           type,
           aspectRatio,
           model,
           createdAt: new Date()
        });
      }
    } catch (error: any) {
      alert("Error generating: " + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const enhancePrompt = async () => {
    if (!prompt || enhancing) return;
    setEnhancing(true);
    try {
      const response = await fetch("/api/enhance-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();
      if (data.enhancedPrompt) setPrompt(data.enhancedPrompt);
    } catch (error) {
      console.error(error);
    } finally {
      setEnhancing(false);
    }
  };

  const deleteImage = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Delete this asset?")) {
      await deleteDoc(doc(db, "images", id));
      if (currentAsset?.id === id) setCurrentAsset(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-dark-900">
        <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-dark-950 p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent-primary/20 mb-4 soft-glow">
             <div className="w-8 h-8 border-4 border-white rounded-full"></div>
          </div>
          <div className="space-y-4">
            <h1 className="text-5xl font-bold tracking-tight text-white uppercase italic">
              Lumina<span className="text-accent-primary">.ai</span>
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed">
              Synthetics-grade high-fidelity image generation for creators.
            </p>
          </div>
          <Button size="lg" className="w-full h-14 text-xl" onClick={handleLogin}>
            Sign in with Google
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-dark-900 text-slate-200 overflow-hidden font-sans">
      <div className="flex flex-col flex-1 overflow-hidden">
        
        {/* Header */}
        <header className="h-16 bg-dark-800 border-b border-white/5 flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-accent-primary rounded-lg flex items-center justify-center">
                <div className="w-4 h-4 border-2 border-white rounded-full"></div>
              </div>
              <span className="text-xl font-bold tracking-tight text-white uppercase italic">
                LUMINA<span className="text-accent-primary">.ai</span>
              </span>
            </div>
            <nav className="hidden md:flex gap-6 text-sm font-medium text-slate-400">
              <button onClick={() => setMode('image')} className={cn("transition-colors pb-5 pt-1 -mb-6", mode === 'image' ? "text-white border-b-2 border-accent-primary" : "hover:text-white")}>Images</button>
              <button onClick={() => setMode('video')} className={cn("transition-colors pb-5 pt-1 -mb-6", (mode === 'video' || mode === 'image-to-video') ? "text-white border-b-2 border-accent-primary" : "hover:text-white")}>Videos</button>
              <a href="#" className="hover:text-white transition-colors">Fine-tune</a>
            </nav>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="px-3 py-1 bg-accent-primary/10 border border-accent-primary/20 rounded-full flex items-center gap-2">
              <div className="w-2 h-2 bg-accent-primary rounded-full animate-pulse"></div>
              <span className="text-[10px] font-bold text-accent-primary uppercase tracking-widest">Unlimited Pro</span>
            </div>
            <div className="relative group">
               <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-white/10" />
               <button onClick={handleLogout} className="absolute right-0 top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-dark-800 p-2 rounded-lg border border-white/10 text-xs text-red-400">
                 Logout
               </button>
            </div>
          </div>
        </header>

        {/* Main Workspace */}
        <main className="flex-1 flex overflow-hidden">
          
          {/* Left Sidebar - Controls */}
          <aside className="w-80 bg-dark-800 border-r border-white/5 flex flex-col z-20">
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              
              {/* Prompt Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest font-mono">Prompt</label>
                  <button 
                    onClick={enhancePrompt} 
                    disabled={enhancing || !prompt}
                    className="text-[10px] text-accent-primary hover:text-white transition-colors flex items-center gap-1 uppercase font-bold"
                  >
                    <Zap className="w-3 h-3" />
                    Enhance
                  </button>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe your vision..."
                  className="w-full h-40 bg-dark-700 border border-white/10 rounded-xl p-4 text-sm text-slate-200 focus:outline-none focus:border-accent-primary transition-colors resize-none placeholder:text-slate-600"
                />
              </div>

              <div className="space-y-4">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest font-mono">Mode</label>
                <div className="flex bg-dark-700 p-1 rounded-xl ui-border">
                  <button 
                    onClick={() => setMode('video')} 
                    className={cn("flex-1 py-2 text-[10px] font-bold uppercase rounded-lg transition-all", mode === 'video' ? "bg-accent-primary text-white" : "text-slate-500 hover:text-slate-300")}
                  >
                    Text to Video
                  </button>
                  <button 
                    onClick={() => setMode('image-to-video')} 
                    className={cn("flex-1 py-2 text-[10px] font-bold uppercase rounded-lg transition-all", mode === 'image-to-video' ? "bg-accent-primary text-white" : "text-slate-500 hover:text-slate-300")}
                  >
                    Image to Video
                  </button>
                </div>
              </div>

              {mode === 'image-to-video' && (
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest font-mono">Reference Image</label>
                  <div className="relative aspect-video rounded-xl border-2 border-dashed border-white/10 hover:border-accent-primary/50 transition-colors flex flex-col items-center justify-center overflow-hidden bg-dark-700 group">
                    {previewUrl ? (
                      <>
                        <img src={previewUrl} className="w-full h-full object-cover" />
                        <button onClick={() => setPreviewUrl(null)} className="absolute top-2 right-2 p-1 bg-black/50 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-opacity">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <Plus className="w-6 h-6 text-slate-600 mb-2" />
                        <span className="text-[10px] text-slate-500 font-bold uppercase">Upload Frame</span>
                      </>
                    )}
                    <input type="file" onChange={onFileChange} className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" />
                  </div>
                </div>
              )}

              {/* Model selection mock */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest font-mono">Architecture</label>
                <div className="w-full flex items-center justify-between px-4 py-3 bg-accent-primary/10 border border-accent-primary/30 rounded-xl">
                   <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-accent-primary" />
                      <span className="text-sm font-medium">{mode === 'image' ? 'Flux v2.5 High-Res' : 'Veo Kinetic v1.0'}</span>
                   </div>
                   <span className="text-[9px] bg-accent-primary text-white px-1.5 py-0.5 rounded-sm font-bold uppercase tracking-wider">Fast</span>
                </div>
              </div>

              {/* Aspect Ratio */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest font-mono">Ratio</label>
                  <span className="text-[10px] text-slate-500 uppercase font-mono">{aspectRatio} Format</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {["1:1", "16:9", "4:3", "9:16"].map(ratio => (
                    <button 
                      key={ratio}
                      onClick={() => setAspectRatio(ratio)}
                      className={cn(
                        "h-10 rounded-lg flex items-center justify-center text-xs font-medium transition-all",
                        aspectRatio === ratio 
                          ? "bg-accent-primary/10 border border-accent-primary/50 text-accent-primary" 
                          : "bg-dark-700 border border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300"
                      )}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-white/5 bg-dark-800">
              <Button 
                onClick={generateAsset}
                isLoading={generating}
                disabled={!prompt || (mode === 'image-to-video' && !selectedFile)}
                className="w-full h-14"
              >
                GENERATE {mode === 'image' ? 'ASSET' : 'MOTION'}
              </Button>
            </div>
          </aside>

          {/* Canvas Section */}
          <section className="flex-1 bg-dark-950 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 p-8 flex items-center justify-center relative bg-[radial-gradient(circle_at_center,_var(--color-dark-900)_0%,_var(--color-dark-950)_100%)]">
              <div className="w-full h-full flex flex-col items-center justify-center">
                <AnimatePresence mode="wait">
                  {generating && !currentAsset ? (
                    <motion.div 
                      key="generation-skeleton"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={cn(
                        "relative rounded-3xl ui-border bg-dark-800/40 soft-glow flex flex-col items-center justify-center shimmer",
                        aspectRatio === "16:9" ? "aspect-video w-full max-w-4xl" : 
                        aspectRatio === "9:16" ? "aspect-[9/16] h-[65vh]" :
                        aspectRatio === "4:3" ? "aspect-[4/3] w-full max-w-3xl" : "aspect-square w-full max-w-3xl"
                      )}
                    >
                      <div className="flex flex-col items-center space-y-6 z-10">
                         <div className="relative">
                            <div className="w-16 h-16 rounded-full border-4 border-accent-primary/10 border-t-accent-primary animate-spin" />
                            <Sparkles className="absolute inset-0 m-auto w-6 h-6 text-accent-primary animate-pulse" />
                         </div>
                         <div className="text-center space-y-1">
                            <p className="text-white font-bold tracking-[0.2em] text-[10px] uppercase">{mode === 'image' ? 'Synthesizing Layers' : 'Temporal Processing'}</p>
                            <p className="text-[10px] text-slate-500 font-mono italic">Lumina AI is processing node clusters...</p>
                         </div>
                      </div>
                    </motion.div>
                  ) : currentAsset ? (
                    <motion.div 
                      key={currentAsset.id}
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={cn(
                        "relative rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-dark-800 group soft-glow",
                        aspectRatio === "16:9" ? "aspect-video w-full max-w-4xl" : 
                        aspectRatio === "9:16" ? "aspect-[9/16] h-[65vh]" :
                        aspectRatio === "4:3" ? "aspect-[4/3] w-full max-w-3xl" : "aspect-square w-full max-w-3xl"
                      )}
                    >
                      {/* Placeholder Shim */}
                      {isAssetLoading && (
                        <div className="absolute inset-0 bg-dark-700 shimmer flex items-center justify-center">
                          <ImageIcon className="w-8 h-8 text-white/5" />
                        </div>
                      )}
                      
                      {currentAsset.type === 'image' ? (
                        <img 
                          src={currentAsset.url} 
                          alt={currentAsset.prompt} 
                          onLoad={() => setIsAssetLoading(false)}
                          className={cn(
                            "w-full h-full object-cover transition-all duration-1000 ease-out",
                            isAssetLoading ? "opacity-0 scale-105 blur-lg" : "opacity-100 scale-100 blur-0"
                          )} 
                          referrerPolicy="no-referrer" 
                        />
                      ) : (
                        <video
                          src={currentAsset.url}
                          autoPlay
                          loop
                          muted
                          playsInline
                          onLoadedData={() => setIsAssetLoading(false)}
                          className={cn(
                            "w-full h-full object-cover transition-all duration-1000 ease-out",
                            isAssetLoading ? "opacity-0 scale-105 blur-lg" : "opacity-100 scale-100 blur-0"
                          )} 
                        />
                      )}

                      {/* Generating Overlay for sequential generations */}
                      {generating && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                           <Loader2 className="w-8 h-8 animate-spin text-accent-primary mb-2" />
                           <span className="text-[10px] font-bold text-white uppercase tracking-widest font-mono">Updating Asset</span>
                        </div>
                      )}

                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-8 flex flex-col justify-end">
                         <h2 className="text-xl font-semibold text-white line-clamp-1">{currentAsset.prompt}</h2>
                         <p className="text-xs text-slate-400 mt-1 uppercase tracking-widest font-mono">
                           {currentAsset.model} • {currentAsset.aspectRatio}
                         </p>
                      </div>
                      <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-all flex gap-2">
                         <button onClick={() => window.open(currentAsset.url)} className="p-2.5 bg-black/60 backdrop-blur-md rounded-xl border border-white/10 hover:bg-white/10 transition-colors text-white">
                           <Download className="w-5 h-5" />
                         </button>
                      </div>
                    </motion.div>
                  ) : (
                     <motion.div 
                      key="empty-state"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center justify-center text-center space-y-6"
                     >
                        <div className="flex flex-col items-center text-slate-600 opacity-50">
                          <div className="w-24 h-24 border-2 border-dashed border-white/10 rounded-3xl flex items-center justify-center mb-6">
                              <ImageIcon className="w-10 h-10" />
                          </div>
                          <p className="text-sm font-medium uppercase tracking-widest">Awaiting prompt parameters</p>
                        </div>
                     </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* History Strip */}
            <div className="h-40 bg-dark-800 border-t border-white/5 p-6 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] font-mono">Recent Generations</h3>
                <span className="text-[10px] text-slate-600 font-mono">STORAGE: {history.length} / ∞</span>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                {history.length === 0 && !generating && (
                   <div className="w-32 h-16 rounded-xl border-2 border-dashed border-white/5 flex items-center justify-center text-slate-700">
                     <Plus className="w-4 h-4" />
                   </div>
                )}
                {history.map((item) => (
                  <motion.div
                    layoutId={item.id}
                    key={item.id}
                    onClick={() => setCurrentAsset(item)}
                    className={cn(
                      "flex-shrink-0 w-32 aspect-video relative group cursor-pointer rounded-xl overflow-hidden border-2 transition-all duration-300",
                      currentAsset?.id === item.id ? "border-accent-primary scale-105 shadow-xl shadow-accent-primary/10" : "border-white/5 grayscale hover:grayscale-0 hover:border-white/20"
                    )}
                  >
                    {item.type === 'image' ? (
                       <img src={item.url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                       <video src={item.url} className="w-full h-full object-cover" muted />
                    )}
                    <button 
                      onClick={(e) => deleteImage(item.id, e)}
                      className="absolute top-1 right-1 p-1 rounded-lg bg-black/60 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>
        </main>

        {/* Status Bar */}
        <footer className="h-10 bg-dark-800 border-t border-white/5 px-6 flex items-center justify-between text-[10px] text-slate-500 font-mono uppercase tracking-wider">
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shadow-sm shadow-green-500/50"></span>
              <span>Lumina Core: Active</span>
            </div>
            <span>Latency: 24ms</span>
            <span className="hidden sm:inline">Node: US-WEST-2-A100</span>
          </div>
          <div className="flex gap-6">
            <span className="text-slate-300 font-bold">Plan: Unlimited Enterprise</span>
            <span className="hidden sm:inline">Safety Filter: AI-Regulated</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

