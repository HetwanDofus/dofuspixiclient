_rotation = 0;
_X = _parent.cellFrom.x;
_Y = _parent.cellFrom.y - 80;
dx = _parent.cellTo.x - _parent.cellFrom.x;
dy = _parent.cellTo.y + 10 - _parent.cellFrom.y + 80;
angle = Math.atan2(dy,dx) * 180 / 3.1415;
