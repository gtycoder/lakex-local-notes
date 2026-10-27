declare const GetDefaultSlashConfig: (lan: "zh-cn" | "en-us") => {
    cardSelect: {
        general: {
            groups: ({
                type: string;
                show: string;
                items: string[];
                title?: undefined;
                name?: undefined;
            } | {
                title: string;
                name: string;
                type: string;
                items: (string | {
                    name: string;
                    childMenus: string[];
                })[];
                show?: undefined;
            })[];
            searchPlaceholder: string;
            recordSelectedItemConfig: {
                enable: boolean;
                maxNum: number;
                title: string;
                type: string;
                itemsConfig: {
                    table: {
                        allowSelector: boolean;
                    };
                };
            };
        };
        table: {
            groups: ({
                type: string;
                show: string;
                items: string[];
                title?: undefined;
                name?: undefined;
            } | {
                title: string;
                name: string;
                type: string;
                items: string[];
                show?: undefined;
            })[];
            searchPlaceholder: string;
            recordSelectedItemConfig: {
                enable: boolean;
                maxNum: number;
                title: string;
                type: string;
                itemsConfig: {
                    table: {
                        allowSelector: boolean;
                    };
                };
            };
        };
        collapse: {
            groups: ({
                type: string;
                show: string;
                items: string[];
                title?: undefined;
                name?: undefined;
            } | {
                title: string;
                name: string;
                type: string;
                items: string[];
                show?: undefined;
            })[];
            searchPlaceholder: string;
            recordSelectedItemConfig: {
                enable: boolean;
                maxNum: number;
                title: string;
                type: string;
                itemsConfig: {
                    table: {
                        allowSelector: boolean;
                    };
                };
            };
        };
    };
    disableQuickInput: boolean;
};
export default GetDefaultSlashConfig;
