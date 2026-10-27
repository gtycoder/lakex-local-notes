import { TocConfig, TocEditingConfig, TocReadingConfig } from "../components/lakex/types";

const DefaultTocEditingConfig: TocEditingConfig = {
    enable: true
}

const DefaultTocReadingConfig: TocReadingConfig = {
    enable: true
}

const DefaultTocConfig: TocConfig = {
    editing: DefaultTocEditingConfig,
    reading: DefaultTocReadingConfig
}

export default DefaultTocConfig;