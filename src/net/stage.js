/**
 * One room, not four people each in their own copy of it.
 *
 * A hall has one curtain. Open it and it is open - for you, for the person two
 * seats along, for whoever walks in an hour later. Same for the house lights,
 * the shape of the screen and how many of the seats have somebody in them.
 * Until this file existed, every browser drew its own private version of all
 * of that, so two people sitting in "the same" hall were looking at two
 * different rooms and reasonably concluded the thing was broken.
 *
 * What is deliberately NOT shared: the sound desk, the picture grade, the
 * language, the stream quality. Those are what one person hears and sees from
 * one seat, and putting them on the wire would let somebody else's headphones
 * decide what your speakers do.
 *
 * The echo problem is the same one show.js has and the answer is the same
 * shape: while we are applying what the hall said, the room module is told to
 * keep quiet, so obeying is never mistaken for deciding.
 *
 *   const stage = createStageSync({ client, room })
 *   stage.dispose()
 */

/**
 * @param {object} options
 * @param {import('./client.js').NetClient} options.client
 * @param {object} options.room the handle from createRoom()
 */
export function createStageSync(options = {}) {
  const { client, room } = options;
  if (!client || !room || typeof room.applyStage !== 'function') {
    return { dispose() {}, get stage() { return null; } };
  }

  let stage = null;
  let disposed = false;
  const off = [];

  function apply(next) {
    if (disposed || !next || typeof next !== 'object') return;
    // Late messages lose. Two people reaching for the curtain at once is
    // ordinary, and without this the slower of the two would win.
    if (stage && Number(next.rev) < Number(stage.rev)) return;
    stage = next;
    const { rev, by, ...values } = next;
    if (Object.keys(values).length) room.applyStage(values);
  }

  off.push(
    client.on('stage', apply),
    client.on('welcome', (msg) => apply(msg?.stage)),
    // The room debounces this for us: a drag is a hundred events and the hall
    // only wants the value the hand stopped on.
    room.onStageChange((values) => {
      if (disposed || !client.online) return;
      client.sendStage(values);
    }),
  );

  /**
   * A hall that has never been used has no room state of its own, so the first
   * person through the door gives it theirs. Anyone after that is given the
   * hall's, by the welcome above.
   */
  if (typeof room.getStage === 'function') {
    const seed = () => {
      if (disposed || !client.online) return;
      if (stage && Number(stage.rev) > 0) return;
      client.sendStage(room.getStage());
    };
    off.push(client.on('welcome', () => setTimeout(seed, 400)));
  }

  return {
    get stage() {
      return stage;
    },
    dispose() {
      disposed = true;
      off.forEach((fn) => typeof fn === 'function' && fn());
    },
  };
}

export default createStageSync;
