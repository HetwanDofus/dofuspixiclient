onClipEvent(enterFrame){
   nbre = _parent._parent.params.fire + _parent._parent.params.water + _parent._parent.params.earth + _parent._parent.params.air;
   if(nbre == 1)
   {
      n = 3;
   }
   if(nbre == 2)
   {
      n = 2;
   }
   if(nbre == 3)
   {
      n = 1;
   }
   if(nbre == 4)
   {
      n = 1;
   }
   if(_parent._parent.params.fire == 1)
   {
      c = c2;
      while(c < c2 + n)
      {
         _parent._parent.attachMovie("part_f","part_f" + c,c);
         eval("_parent._parent.part_f" + c)._x = _parent._x;
         eval("_parent._parent.part_f" + c)._y = _parent._y;
         c++;
      }
      c2++;
   }
   if(_parent._parent.params.water == 1)
   {
      c = c2;
      while(c < c2 + n)
      {
         _parent._parent.attachMovie("part_w","part_w" + c,c);
         eval("_parent._parent.part_w" + c)._x = _parent._x;
         eval("_parent._parent.part_w" + c)._y = _parent._y;
         c++;
      }
      c2++;
   }
   if(_parent._parent.params.earth == 1)
   {
      c = c2;
      while(c < c2 + n)
      {
         _parent._parent.attachMovie("part_e","part_e" + c,c);
         eval("_parent._parent.part_e" + c)._x = _parent._x;
         eval("_parent._parent.part_e" + c)._y = _parent._y;
         c++;
      }
      c2++;
   }
   if(_parent._parent.params.air == 1)
   {
      c = c2;
      while(c < c2 + n)
      {
         _parent._parent.attachMovie("part_a","part_a" + c,c);
         eval("_parent._parent.part_a" + c)._x = _parent._x;
         eval("_parent._parent.part_a" + c)._y = _parent._y;
         c++;
      }
      c2++;
   }
}
