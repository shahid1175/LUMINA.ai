import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.post("/api/generate", async (req, res) => {
    try {
      const { prompt, aspectRatio = "16:9" } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      console.log(`Generating image for prompt: ${prompt}`);

      // Using the correct modern SDK pattern from @google/genai
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: { parts: [{ text: prompt }] },
        config: {
          imageConfig: {
            aspectRatio: aspectRatio,
          },
        },
      });

      let imageData = null;
      let textResponse = response.text || "";

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          imageData = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }

      if (!imageData) {
        return res.status(500).json({ error: "Image generation model did not return an image." });
      }

      res.json({ url: imageData, text: textResponse });
    } catch (error: any) {
      console.error("Generation error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/generate-video", async (req, res) => {
    try {
      const { prompt, aspectRatio = "16:9" } = req.body;
      if (!prompt) return res.status(400).json({ error: "Prompt is required" });

      console.log(`Generating video for prompt: ${prompt}`);

      const operation = await ai.models.generateVideos({
        model: 'veo-3.1-lite-generate-preview',
        prompt,
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: aspectRatio === "9:16" ? "9:16" : "16:9"
        }
      });

      res.json({ operationName: operation.name });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/image-to-video", async (req, res) => {
    try {
      const { prompt, image, aspectRatio = "16:9" } = req.body;
      if (!image) return res.status(400).json({ error: "Reference image is required" });

      console.log(`Generating image-to-video for prompt: ${prompt}`);

      const [mimeType, data] = image.split(",")[1] ? [image.split(";")[0].split(":")[1], image.split(",")[1]] : ["image/jpeg", image];

      const operation = await ai.models.generateVideos({
        model: 'veo-3.1-lite-generate-preview',
        prompt: prompt || "Animate this scene naturally.",
        image: {
          imageBytes: data,
          mimeType: mimeType
        },
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: aspectRatio === "9:16" ? "9:16" : "16:9"
        }
      });

      res.json({ operationName: operation.name });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/video-status", async (req, res) => {
    try {
      const { operationName } = req.body;
      // @ts-ignore
      const { GenerateVideosOperation } = await import('@google/genai');
      
      const op = new GenerateVideosOperation();
      op.name = operationName;
      
      const updated = await ai.operations.getVideosOperation({ operation: op });
      res.json({ done: updated.done, error: updated.error });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/video-download", async (req, res) => {
    try {
      const operationName = req.query.operationName as string;
      // @ts-ignore
      const { GenerateVideosOperation } = await import('@google/genai');
      
      const op = new GenerateVideosOperation();
      op.name = operationName;
      
      const updated = await ai.operations.getVideosOperation({ operation: op });
      const uri = updated.response?.generatedVideos?.[0]?.video?.uri;
      
      if (!uri) return res.status(404).json({ error: "Video URI not found" });

      const videoRes = await fetch(uri, {
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY! },
      });

      res.setHeader('Content-Type', 'video/mp4');
      if (videoRes.body) {
         // Using standard node-fetch/undici style body stream or converting to express stream
         const reader = videoRes.body.getReader();
         while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
         }
         res.end();
      } else {
         res.status(500).send("No video body");
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/enhance-prompt", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt) return res.status(400).json({ error: "Prompt is required" });

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Enhance this image generation prompt to be more descriptive and artistic. Keep it under 50 words. Original prompt: "${prompt}"`,
      });

      res.json({ enhancedPrompt: response.text });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
