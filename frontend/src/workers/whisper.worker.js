import { pipeline, env } from '@xenova/transformers';

// Disable local models since we download from huggingface
env.allowLocalModels = false;

class PipelineSingleton {
    static task = 'automatic-speech-recognition';
    static model = 'Xenova/whisper-tiny.en';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            this.instance = pipeline(this.task, this.model, { progress_callback });
        }
        return this.instance;
    }
}

// Listen for messages from the main thread
self.addEventListener('message', async (event) => {
    const { type, audio } = event.data;

    try {
        if (type === 'load') {
            // Load the model
            self.postMessage({ status: 'loading' });
            let transcriber = await PipelineSingleton.getInstance(x => {
                self.postMessage({ status: 'progress', progress: x });
            });
            self.postMessage({ status: 'ready' });
        } else if (type === 'transcribe') {
            self.postMessage({ status: 'decoding' });
            let transcriber = await PipelineSingleton.getInstance();
            let result = await transcriber(audio, {
                // Settings for streaming or chunking (optional but good for stability)
                chunk_length_s: 30,
                stride_length_s: 5,
                language: 'english',
                task: 'transcribe'
            });
            self.postMessage({ status: 'complete', text: result.text.trim() });
        }
    } catch (e) {
        self.postMessage({ status: 'error', error: e.message });
    }
});
