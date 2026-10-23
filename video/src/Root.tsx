import { Composition } from "remotion";
import { FPS, H, W } from "./theme";
import { TOTAL_FRAMES, Video } from "./Video";

export const Root: React.FC = () => <Composition id="Domino" component={Video} durationInFrames={TOTAL_FRAMES} fps={FPS} width={W} height={H} />;
