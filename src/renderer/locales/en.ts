/**
 * English interface text. Keys are the Chinese text written in the source (see src/shared/i18n.ts);
 * values may use {0}…{9} placeholders and {0|one|many} for count-dependent nouns.
 * Files are split by area only to keep them readable; a key may live in any of them.
 */
import app from './en/app';
import desk from './en/desk';
import executors from './en/executors';
import executors2 from './en/executors-2';
import extensions from './en/extensions';
import project from './en/project';
import project2 from './en/project-2';
import room from './en/room';
import room2 from './en/room-2';
import roundtable from './en/roundtable';
import settings from './en/settings';
import settings2 from './en/settings-2';
import shared from './en/shared';
import data from './en/data';

export const EN_MESSAGES: Readonly<Record<string, string>> = {
  ...shared, ...data, ...app, ...desk, ...executors, ...executors2, ...extensions,
  ...project, ...project2, ...room, ...room2, ...roundtable, ...settings, ...settings2,
};
