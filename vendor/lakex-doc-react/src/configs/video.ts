import { VideoConfig } from "../components/lakex/types";

const DefaultViedoConfig: VideoConfig = {
     createUploadPromise: (f: File) => {
        const url = URL.createObjectURL(f)
        return Promise.resolve({
            url: url,
            size: f.size,
            filename: f.name,
        });
     }
}

export default DefaultViedoConfig