import { FileConfig } from "../components/lakex/types";

const DefaultFileConfig:FileConfig = {
    createUploadPromise: (f: File) => {
        const url = URL.createObjectURL(f)
        return Promise.resolve({
            url: url,
            size: f.size,
            filename: f.name,
        });
    }
}
export default DefaultFileConfig
