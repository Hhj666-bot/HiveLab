import {useLayoutEffect} from 'react';
import {motionLevel,REDUCED_MOTION_QUERY} from '../../shared/motion';
import {useAppearancePreference} from '../appearance-preferences';
import {useMediaPreference} from '../media-preferences';

export function useMotionLevel(){return motionLevel(useAppearancePreference('motion'),useMediaPreference(REDUCED_MOTION_QUERY));}
/** Publishes the level on <html>, the only motion switch CSS reads. */
export function useMotionRoot(){
 const level=useMotionLevel();
 useLayoutEffect(()=>{document.documentElement.dataset.motion=level;},[level]);
}
