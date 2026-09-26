import {PinnedShot} from "./pinned-shot";
import {ImageEditor} from "./image-editor";
export function CaptureWindow(){return new URLSearchParams(location.search).get("window")==="shot-editor"?<ImageEditor/>:<PinnedShot/>;}
