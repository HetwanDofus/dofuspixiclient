_rotation = 0;
_X = _parent.cellFrom.x;
_Y = _parent.cellFrom.y - 25;
dx = _parent.cellTo.x - _parent.cellFrom.x;
dy = _parent.cellTo.y - _parent.cellFrom.y + 25;
angle = Math.atan2(dy,dx) * 180 / 3.1415;
