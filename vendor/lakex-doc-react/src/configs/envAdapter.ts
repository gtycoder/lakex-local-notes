import { EnvAdapter } from "../components/lakex/types";

const visitLink = (url: string, isExternal: boolean) => {
    window.open(url, isExternal ? '__blank': '__self');
}
const DefaultEnvAdapterConfig: EnvAdapter = {
    openLink: visitLink,
    openBookmarkLink: (url: string) => {
        window.open(url, '__blank');
    },
    openMentionLink: visitLink,
    longPressCard: (params: Record<string, any>) =>{
        console.log(params)
    }
}

export default DefaultEnvAdapterConfig;