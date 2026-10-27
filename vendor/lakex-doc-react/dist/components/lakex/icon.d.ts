import React from "react";
export type TIcon = React.ElementType | React.ComponentType | React.FC;
declare const SvgIcon: (props: {
    icons: TIcon[];
}) => any;
export default SvgIcon;
