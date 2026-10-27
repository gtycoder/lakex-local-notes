import { LakexEditorConfig } from "../components/lakex/types";
import DefaultAudioConfig from "./audio";
import DefaultCustomCardConfig from "./customCard";
import DefaultEnvAdapterConfig from "./envAdapter";
import DefaultFileConfig from "./file";
import DefaultHeadingConfig from "./heading";
import DeafultImageConfig from "./image";
import DefaultInputConfig from "./input";
import GetdeGetDefaultSlashConfig from "./slash";
import DefaultTocConfig from "./toc";
import DefaultViedoConfig from "./video";


const GetDefaultEditorConfig = (lan: 'zh-cn' | 'en-us'):LakexEditorConfig => {
    return {
        image: DeafultImageConfig,
        audio: DefaultAudioConfig,
        video: DefaultViedoConfig,
        envAdapter: DefaultEnvAdapterConfig,
        file: DefaultFileConfig,
        heading: DefaultHeadingConfig,
        input: DefaultInputConfig,
        slash: GetdeGetDefaultSlashConfig(lan),
        toc: DefaultTocConfig.editing,
        customCard: DefaultCustomCardConfig,
        // 书签插件：派生 getter isEnable 要求提供 detailAction 或 fetchDetailHandler 才注册卡片。
        // 默认实现不抓取远程页面，直接以 url 作为标题返回最小 detail 对象。
        // 如需拉取 OG / meta 信息，可在此换成自有后端代理 detailAction，或自定义 fetchDetailHandler。
        bookmark: {
            
            fetchDetailHandler: (url: string) => {
                return Promise.resolve({
                icon: "",
                image: "",
                title: url,
                desc: "",
                url,
            })
            },
            pasteLinkConvert: true,
        },
    }
}

export default GetDefaultEditorConfig