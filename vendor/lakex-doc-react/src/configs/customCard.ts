import { mindMapCard } from "../cards/MindMapCard";
import { textToDiagramCard } from "../cards/TextToDiagram";
import {
    drawingBoardCard,
    flowchartBoardCard,
    mindmapBoardCard,
    umlBoardCard,
} from "../cards/DrawingBoard";
import { CustomCardsConfig } from "../components/lakex/types";

const DefaultCustomCardConfig: CustomCardsConfig = {
    cards: [
        mindMapCard,
        textToDiagramCard,
        drawingBoardCard,
        flowchartBoardCard,
        umlBoardCard,
        mindmapBoardCard,
    ]
}

export default DefaultCustomCardConfig;
