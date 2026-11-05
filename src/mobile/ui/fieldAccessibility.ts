/** 设置行只传无障碍关联元数据，控件保留各端独立实现。 */
import { createContext, useContext } from "react";
import type { AriaAttributes } from "react";
export const SettingFieldContext = createContext<Pick<AriaAttributes, "aria-labelledby" | "aria-describedby" | "aria-invalid">>({});
export const useSettingField = () => useContext(SettingFieldContext);
