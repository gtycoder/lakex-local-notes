import { AudioConfig } from "../components/lakex/types";

const DefaultAudioConfig: AudioConfig = {
    createUploadPromise: (f: File) => {
        const url = URL.createObjectURL(f)
        return Promise.resolve({
            audioUrl: url,
            downloadUrl: url,
            filesize: f.size,
            filename: f.name,
        });
    }
}

export default DefaultAudioConfig;