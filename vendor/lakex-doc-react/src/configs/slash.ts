import { SlashConfig } from "../components/lakex/types";

const i18nMap = {
    'zh-cn': {
        'base': '基础',
        'layout': '布局和样式',
        'tools': '小工具',
        'drawing-board': '画板',
        'programmer': '程序员',
        'third-party-services': '第三方服务',
        'search': '请输入搜索内容',
        'recently-used': '最近使用',
    },
    'en-us': {
        'base': 'Basic',
        'layout': 'Layout and style',
        'tools': 'Tools',
        'drawing-board': 'Drawing Board',
        'programmer': 'Programmer\'s area',
        'third-party-services': 'Embed third-party services',
        'search': 'Search by funtion name',
        'recently-used': 'Recently used',
    }
}


const GetDefaultSlashConfig = (lan: 'zh-cn' | 'en-us') => {
    return {
    "cardSelect": {
        "general": {
            "groups": [
                {
                    "type": "icon",
                    "show": "slash",
                    "items": [
                        "p",
                        "h1",
                        "h2",
                        "h3",
                        "h4",
                        "h5",
                        "h6",
                        "unorderedList",
                        "orderedList",
                        "taskList",
                        "link",
                        "code",
                    ]
                },
                {
                    "title": i18nMap[lan]['base'],
                    "name": "group-base",
                    "type": "column",
                    "items": [
                        "image",
                        "table",
                        "file",
                        "video",
                        "audio",
                        "label"
                    ]
                },
                {
                    "title": i18nMap[lan]['layout'],
                    "name": "group-layout",
                    "type": "normal",
                    "items": [
                        "quote",
                        "hr",
                        "alert",
                        {
                            "name": "columns",
                            "childMenus": [
                                "columns2",
                                "columns3",
                                "columns4"
                            ]
                        },
                        "collapse"
                    ]
                },
                {
                    "title": i18nMap[lan]['drawing-board'],
                    "name": "group-drawing-board",
                    "type": "normal",
                    "items": [
                        "custom-drawing-board",
                        "custom-flowchart-board",
                        "custom-uml-board",
                        "custom-drawing-mindmap-board"
                    ]
                },
                {
                    "title": i18nMap[lan]['programmer'],
                    "name": "group-files",
                    "type": "normal",
                    "items": [
                        "codeblock",
                        "math",
                        "custom-text-to-diagram"
                    ]
                },
                {
                    "title": i18nMap[lan]['tools'],
                    "name": "group-files",
                    "type": "normal",
                    "items": [
                        // "mention",
                        "calendar",
                        "dateCard",
                        "unicodeEmoji",
                    ]
                },
                {
                    "title": i18nMap[lan]['third-party-services'],
                    "name": "third-party-services",
                    "type": "normal",
                    "items": [
                        "amap",
                        "bilibili",
                        "canva",
                        "figma",
                        "juejin",
                        "modao",
                        "music163",
                        "processon",
                        "youku",
                    ]
                }
            ],
            "searchPlaceholder": i18nMap[lan]['search'],
            "recordSelectedItemConfig": {
                "enable": true,
                "maxNum": 3,
                "title": "最近使用",
                "type": "label",
                "itemsConfig": {
                    "table": {
                        "allowSelector": true
                    }
                }
            }
        },
        "table": {
            "groups": [
                {
                    "type": "icon",
                    "show": "slash",
                    "items": [
                        "p",
                        "h1",
                        "h2",
                        "h3",
                        "h4",
                        "h5",
                        "h6",
                        "unorderedList",
                        "orderedList",
                        "taskList",
                        "link",
                        "code"
                    ]
                },
                {
                    "title": i18nMap[lan]['base'],
                    "name": "group-base",
                    "type": "column",
                    "items": [
                        "image",
                        "file",
                        "video",
                        "audio",
                        "label"
                    ]
                },
                {
                    "title": i18nMap[lan]['layout'],
                    "name": "group-layout",
                    "type": "normal",
                    "items": [
                        "quote",
                        "hr",
                        "alert"
                    ]
                },
                {
                    "title": i18nMap[lan]['drawing-board'],
                    "name": "group-drawing-board",
                    "type": "normal",
                    "items": [
                        "custom-drawing-board",
                        "custom-flowchart-board",
                        "custom-uml-board",
                        "custom-drawing-mindmap-board"
                    ]
                },
                {
                    "title": i18nMap[lan]['programmer'],
                    "name": "group-files",
                    "type": "normal",
                    "items": [
                        "math",
                        "codeblock",
                        "custom-text-to-diagram"
                    ]
                },
                {
                    "title": i18nMap[lan]['tools'],
                    "name": "group-files",
                    "type": "normal",
                    "items": [
                        "dateCard",
                        "unicodeEmoji"
                    ]
                },
                {
                    "title": i18nMap[lan]['third-party-services'],
                    "name": "third-party-services",
                    "type": "normal",
                    "items": [
                        "amap",
                        "bilibili",
                        "canva",
                        "figma",
                        "juejin",
                        "modao",
                        "music163",
                        "processon",
                        "youku",
                    ]
                }
            ],
            "searchPlaceholder": i18nMap[lan]['search'],
            "recordSelectedItemConfig": {
                "enable": true,
                "maxNum": 3,
                "title": i18nMap[lan]['recently-used'],
                "type": "label",
                "itemsConfig": {
                    "table": {
                        "allowSelector": true
                    }
                }
            }
        },
        "collapse": {
            "groups": [
                {
                    "type": "icon",
                    "show": "slash",
                    "items": [
                        "p",
                        "h1",
                        "h2",
                        "h3",
                        "h4",
                        "h5",
                        "h6",
                        "unorderedList",
                        "orderedList",
                        "taskList",
                        "link",
                        "code"
                    ]
                },
                {
                    "title": i18nMap[lan]['base'],
                    "name": "group-base",
                    "type": "column",
                    "items": [
                        "image",
                        "file",
                        "video",
                        "audio",
                        "label"
                    ]
                },
                {
                    "title": i18nMap[lan]['layout'],
                    "name": "group-layout",
                    "type": "normal",
                    "items": [
                        "quote",
                        "hr",
                        "alert"
                    ]
                },
                {
                    "title": i18nMap[lan]['drawing-board'],
                    "name": "group-drawing-board",
                    "type": "normal",
                    "items": [
                        "custom-drawing-board",
                        "custom-flowchart-board",
                        "custom-uml-board",
                        "custom-drawing-mindmap-board"
                    ]
                },
                {
                    "title": i18nMap[lan]['programmer'],
                    "name": "group-files",
                    "type": "normal",
                    "items": [
                        "codeblock",
                        "math",
                        "custom-text-to-diagram"
                    ]
                },
                {
                    "title": i18nMap[lan]['tools'],
                    "name": "group-files",
                    "type": "normal",
                    "items": [
                        "calendar",
                        "dateCard",
                        "unicodeEmoji"
                    ]
                },
                {
                    "title": i18nMap[lan]['third-party-services'],
                    "name": "third-party-services",
                    "type": "normal",
                    "items": [
                        "amap",
                        "bilibili",
                        "canva",
                        "figma",
                        "juejin",
                        "modao",
                        "music163",
                        "processon",
                        "youku",
                    ]
                }
            ],
            "searchPlaceholder": i18nMap[lan]['search'],
            "recordSelectedItemConfig": {
                "enable": true,
                "maxNum": 3,
                "title": i18nMap[lan]['recently-used'],
                "type": "label",
                "itemsConfig": {
                    "table": {
                        "allowSelector": true
                    }
                }
            }
        }
    },
    "disableQuickInput": false
}
}

export default GetDefaultSlashConfig
