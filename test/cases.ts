import { questions,samples } from "../lib/demo";

export const cases = [
  {question:questions[0],expected:[{name:samples[0].name, location:"Page 2"},{name:samples[1].name,location:samples[1].location}]},
  {question:questions[1],expected:[{name:samples[0].name, location:"Page 3"}]},
  {question:"When can I reach the Premium support team?",expected:[{name:samples[1].name,location:samples[1].location}]},
  {question:questions[2],expected:[]},
];

export const distractors = [
  "The office supply cabinet is restocked on Tuesday.",
  "Blue badges are issued to visitors at the reception desk.",
  "Keep the service elevator clear during delivery windows.",
  "Book meeting rooms on the shared calendar.",
  "Label refrigerated food with a date before storing it.",
  "The design archive is grouped by project and year.",
  "Use a clean cloth for whiteboard surfaces.",
  "The bicycle rack is beside the south entrance.",
  "Return borrowed adapters to the equipment drawer.",
  "Recycling bins are available on each floor.",
  "The garden closes whenever lightning is forecast.",
  "Office plants are watered on Wednesday mornings.",
].join("\n\n");

export function score(evidence:{name:string;location:string}[], expected:typeof cases[number]["expected"]) {
  return expected.filter(target=>evidence.some(item=>item.name===target.name&&item.location===target.location)).length;
}
